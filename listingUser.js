const TradeOfferManager = require('steam-tradeoffer-manager');
const { parseString } = require('tf2-item-format/static');
const SteamCommunity = require('steamcommunity');
const { toSKU } = require('tf2-item-format');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const config = require('./config.json');
const chokidar = require('chokidar');
const readline = require('readline');
const SteamID = require('steamid');
const chalk = require('chalk');
const axios = require('axios');
const fs = require('fs');

//Need to check if the bot has enough metal/keys to buy item & also check that it doesn't have the item already!


async function fetchTF2Inventory(steamID) {
  const steamIdInstance = new SteamID(steamID.toString());

  try {
    const response = await axios.get('https://api.steampowered.com/IEconItems_440/GetPlayerItems/v0001/', {
      params: {
        key: config.STEAM_API_KEY,
        steamid: steamIdInstance.toString()
      }
    });
    const body = response.data;

    if (body.result?.status !== 1) {
      throw new Error(body.result?.statusDetail);
    }

    return body.result.items || [];
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.message);
    }
    throw error;
  }
}

function getRefreshToken(callback) {
  const client = new SteamUser();
  let refreshToken;

  const logOnOptions = {
    twoFactorCode: SteamTotp.generateAuthCode(config.STEAM_SHARED_SECRET),
    accountName: config.STEAM_USERNAME,
    password: config.STEAM_PASSWORD,
    rememberPassword: true
  };

  client.logOn(logOnOptions);
  client.on('loggedOn', () => {
    console.log(chalk.yellow('JS:'),'Logged into Steam as:', chalk.italic(config.STEAM_USERNAME));
    client.setPersona(SteamUser.EPersonaState.Online);
    client.gamesPlayed(["Making Profit", 440]);
  });

  client.on('loginKey', (loginKey) => {
    refreshToken = loginKey;
  });

  client.on('webSession', (sessionid, cookies) => {
    callback(refreshToken, client, cookies);
  });
}

async function checkResponseTime(client, steamID) {
  return new Promise((resolve, reject) => {
    client.chat.sendFriendMessage(steamID, '!sell');
    console.log(chalk.yellow('JS:'), 'Trigger message sent to user!');
    const startTime = Date.now();
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        console.log(chalk.yellow('JS:'), 'User did not respond in time!');
        resolve(false);
      }
    }, 3000);

    function handleFriendMessage(steamIDreceive, message) {
      const deltaTime = Date.now() - startTime;
      console.log(chalk.yellow('JS:'), 'Response Time:', deltaTime, 'ms!');
      client.removeListener(`friendMessage#${steamID}`, handleFriendMessage);
      clearTimeout(timer);
      resolved = true;
      resolve(true);      
    }

    client.on(`friendMessage#${steamID}`, handleFriendMessage);
  });
}

function checkBot(client, steamID) {
  return new Promise((resolve, reject) => {
    let timer;

    // Add user to friend list:
    client.addFriend(steamID, async (err, addedPersonaName) => {
      if (err && err.eresult === 25) {
        console.log(chalk.yellow('JS:'), 'Friendlist is full.');
      }
      if (err && err.eresult === SteamUser.EResult.DuplicateName) {
        console.log(chalk.yellow('JS:'), 'User is already a friend! testing if online...');
        checkResponseTime(client, steamID)
          .then(resolve)
          .catch(reject);

      } else if (err) {
        console.log(chalk.yellow('JS:'), 'Error adding friend:', chalk.red(err.message));
        resolve(false);
      } else {
        console.log(chalk.yellow('JS:'), 'Friend request sent! Waiting for response...');
        timer = setTimeout(() => {
          console.log(chalk.yellow('JS:'), 'User did not respond in time -> Removing friend');
          client.removeFriend(steamID);
          resolve(false);
        }, 3000);
      }
    });

    
    // Check if user accepted friend request:
    client.on(`friendRelationship#${steamID}`, (steamID, relationship) => {
      if (relationship === SteamUser.EFriendRelationship.Friend) {
        console.log(chalk.yellow('JS:'),'Friend request accepted! Checking response time...');
        clearTimeout(timer);
        checkResponseTime(client, steamID)
          .then(resolve)
          .catch(reject);
      }
    });
  });
}

function scrapToPure(price, keyPrice) {
  const refinedPrice = 9; // Scrap equivalent of 1 refined
  const reclaimedPrice = 3; // Scrap equivalent of 1 reclaimed
  const amtKeys = Math.floor(price / keyPrice);
  const amtRefined = Math.floor((price % keyPrice) / refinedPrice);
  const amtReclaimed = Math.floor(((price % keyPrice) % refinedPrice) / reclaimedPrice);
  const amtScraps = ((price % keyPrice) % refinedPrice) % reclaimedPrice;

  return [amtKeys, amtRefined, amtReclaimed, amtScraps];
}

async function checkInventory(steamID, price, name, keyPrice, retryCount) {
  const skuScrap = '5000;6';
  const skuRec = '5001;6';
  const skuRef = '5002;6';
  const skuKey = '5021;6';

  const [amtKeys, amtRefined, amtReclaimed, amtScraps] = scrapToPure(price, keyPrice);

  try {
    const items = await fetchTF2Inventory(steamID);
    const itemCounts = {};

    for (const item of items) {
      if (!item.hasOwnProperty('flag_cannot_craft')) {
        item.craftable = true;
      } else {
        item.craftable = false;
      }

      //Convert item to SKU
      const sku = toSKU(item);

      //Dictionary of items
      itemCounts[sku] = (itemCounts[sku] || 0) + 1;
    }
    //console.log('\n'+chalk.yellow('JS:'),"Needed Pure:", amtKeys, amtRefined, amtReclaimed, amtScraps)
    //console.log(chalk.yellow('JS:'),"User's Pure:", itemCounts[skuKey], itemCounts[skuRef], itemCounts[skuRec], itemCounts[skuScrap],'\n')

    if (
      (itemCounts.hasOwnProperty(skuScrap) && itemCounts[skuScrap] >= amtScraps) &&
      (itemCounts.hasOwnProperty(skuRec) && itemCounts[skuRec] >= amtReclaimed) &&
      (itemCounts.hasOwnProperty(skuRef) && itemCounts[skuRef] >= amtRefined) &&
      (itemCounts.hasOwnProperty(skuKey) && itemCounts[skuKey] >= amtKeys)
    ) {
      console.log(chalk.yellow('JS:'), chalk.green('User has enough pure!'));
      const attributes = parseString(name, true, true);
      if (!itemCounts.hasOwnProperty(toSKU(attributes))) { // Check if bot already has item!
        console.log(chalk.yellow('JS:'), chalk.green('User does not have item!'));
        return true;
      } else {
        console.log(chalk.yellow('JS:'), chalk.red('User already has item!'));
        return false;
      }
    } else {
      console.log(chalk.yellow('JS:'), chalk.red('User does not have enough pure!'));
      return false;
    } 
  } catch (error) {
    if (retryCount < 100) {
      retryCount++;
      console.log(retryCount)
      //console.error('fetchInventory:', chalk.red(error.message), '-', 'Retrying in', chalk.yellow('100ms'));
      await new Promise((resolve) => setTimeout(resolve, 100)); // Adjust the delay as needed
      return checkInventory(steamID, price, name, keyPrice, retryCount); // Recursive call to repeat the function
    } else {
      console.log(chalk.yellow('JS:'),'Exceeded maximum retry limit. Skipping checkInventory.');
      return false;
    }
  }
}

async function update_csv(lineToModify, botListings, action) {
  return new Promise((resolve, reject) => {
    const regex = /([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)/;
    let displayName = '';

    const rl = readline.createInterface({
      input: fs.createReadStream('listings.csv'),
      output: fs.createWriteStream('temp.csv'),
      terminal: false
    });

    rl.on('line', (line) => {
      if (line === lineToModify && action === 'isBot') {
        const [, name, buyPrice, listingsStr, keyPrice, scrapTF, isBot] = line.match(regex);
        const strListings = `{${Object.entries(botListings).map(([key, value]) => `'${key}': ${value}`).join(', ')}}`; //Converting object to string dict
        const modifiedLine = `${name},${buyPrice},${strListings},${keyPrice},${scrapTF},True`;

        fs.appendFile('buyItem.csv', modifiedLine + '\n', (err) => {
          if (err) {
            console.error('Error appending to buyItem.csv:', err);
          }
        console.log(chalk.yellow('JS:'), chalk.bold(name), 'added to buyItem.csv!')
        resolve(true)
        });

      } else if (line === lineToModify && action === 'del') {
        const [, name, buyPrice, listingsStr, keyPrice, scrapTF, isBot] = line.match(regex);
        displayName = name;
      } else if (action === 'del') {
        rl.output.write(line + '\n');
      }
    });

    if (action === 'del') {
      rl.on('close', () => {
        rl.input.close();
        rl.output.close();
        fs.unlink('listings.csv', (unlinkErr) => {
          if (unlinkErr) {
            console.error('Error unlinking file:', unlinkErr);
            reject(unlinkErr);
          } else if (action === 'del') {
            fs.rename('temp.csv', 'listings.csv', (renameErr) => {
              if (renameErr) {
                console.error('Error renaming file:', renameErr);
                reject(renameErr);
              } else if (action === 'del') {
                console.log(chalk.yellow('JS:'), chalk.bold(displayName), 'removed from listings.csv!\n');
                resolve(true);
              }
            });
          }
        });
      });
    }
  });
}

async function processCSV(client) {
  return new Promise((resolve, reject) => {

    const regex = /([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)/;
    const results = [];

    let botListings = {};
    let lineMod = '';

    const rl = readline.createInterface({
      input: fs.createReadStream('listings.csv'),
      output: process.stdout,
      terminal: false
    });

    rl.on('line', (line) => {
      const [, name, buyPrice, listingsStr, keyPrice, scrapTF, isBot] = line.match(regex);
      const listings = JSON.parse(listingsStr.replace(/'/g, "\""));
      lineMod = line;

      results.push({
        name,
        buyPrice: parseInt(buyPrice),
        listings,
        keyPrice: parseInt(keyPrice),
        scrapTF: scrapTF === 'True',
        isBot: isBot === 'True'
      });
    });

    rl.on('close', async () => {
      if (results.length === 0) {
        return;
      }

      console.log('\n'+chalk.yellow('JS:'), chalk.bold('listings.csv changed. Processing...'));
      console.log(chalk.yellow('JS:'), 'CSV file read.', chalk.bold(results.length, 'item(s) found'));

      for (const result of results) {
        if (result['isBot']) {
          console.log(chalk.yellow('JS:'), 'Skipping row:', chalk.bold(result['name']));
          continue;
        }

        let sortedListings = Object.entries(result['listings']).sort((a, b) => b[1] - a[1]);
        for (const [key, value] of sortedListings) {
          let retryCount = 0;
          if (Object.keys(botListings).length === 3) {
            console.log('\n' + chalk.yellow('JS:'), chalk.greenBright('Sufficient botListings. Continuing...'))
            break;
          }
          const [steamID, sellPrice] = [key, value];
          console.log('\n' + chalk.green(chalk.underline(steamID)));

          try {
            const res = await checkBot(client, steamID);
            if (res === true && sellPrice > result['buyPrice']) {
              console.log(chalk.yellow('JS:'), chalk.green('User is bot:', res,'\n'));
              //console.log(chalk.yellow('JS:'), "Checking user's inventory...");
              //const hasInventory = await checkInventory(steamID, sellPrice, result['name'], result['keyPrice'], retryCount);
              const hasInventory = true;
              if (hasInventory === true) {
                console.log(chalk.yellow('JS:'), 'Pushing user to botListings...');
                botListings[steamID.toString()] = sellPrice;
                //break; If only want to check the first listing
              } else {
                console.log(chalk.yellow('JS:'), 'Not pushing user to botListings...');
              }
            } else {
              console.log(chalk.yellow('JS:'), chalk.red('User is bot:', res,'\n'));
              continue
            }
          } catch (error) {
            console.log(chalk.yellow('JS:'), chalk.red('User is bot:', error,'\n'));
            continue
          }
        }
        if (Object.keys(botListings).length > 0) {
          await update_csv(lineMod, botListings, 'isBot')
          await update_csv(lineMod, botListings, 'del')
          resolve('isBot');
        } else {
          await update_csv(lineMod, botListings, 'del')
          resolve('0listings'); // Return if 0 bot listings 
        }
        resolve('skipping')
      }
      resolve('skipping');
    });
    rl.on('error', error => {
      console.error(chalk.yellow('JS:'), 'Error reading CSV file:', error);
      reject(error);
    });
    resolve('skipping')
  });
}

getRefreshToken(async (refreshToken, client, cookies) => {
  const listingsWatcher = chokidar.watch('listings.csv');
  let listingsProcessing = false;
  let listingsQueue = [];

  async function queueManager() {
    if (!listingsProcessing && listingsQueue.length > 0) {
      listingsProcessing = true;
      const res = await processCSV(client);
      listingsProcessing = false;
      listingsQueue.shift();
      console.log(listingsQueue, listingsProcessing)
      queueManager();
    }
  }

  listingsWatcher.on('change', async (path) => {
    listingsQueue.push('change');
    if (!listingsProcessing) {
      queueManager(); // Start processing if not already processing
    } else {
      console.log(listingsQueue, listingsProcessing)
      console.log(chalk.yellow('JS:'), chalk.bold(chalk.redBright('Already processing CSV file!\n')));
    }
  });
  
  //Check all incoming trade offers and for each trade offer check if it is in the TradeOffers.csv file and if
  //so check if the trade offer from scrapTF is good and in that case accept the trade offer and after that
  //send a message to bot !sell name and wait for that offer to be received, accept it and then onto next trade.
  const community = new SteamCommunity();
  const manager = new TradeOfferManager({
    steam: client,
    community: community,
    language: 'en'
  }); 

  //cookies from webSession
  manager.setCookies(cookies);
  community.setCookies(cookies);
  community.startConfirmationChecker(5000, config.STEAM_IDENTITY_SECRET);

  async function acceptOffer(offer) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        offer.accept((err) => {
          if (err) {
            console.log(chalk.yellow('JS:'), chalk.red('Error accepting offer:', err.message))
            resolve(acceptOffer(offer));
          } else {
            community.checkConfirmations();
            console.log(chalk.yellow('JS:'), 'Offer #' + offer.id, 'accepted!');
            resolve(true)
          }
        });
      }, 2000);
    })
  }

  async function declineOffer(offer) {  
    return new Promise((resolve, reject) => {
      offer.decline((err) => {
        if (err) {
          console.log(chalk.yellow('JS:'), chalk.red('Error declining offer:', err.message));
          resolve(declineOffer(offer));
        } else {
          console.log(chalk.yellow('JS:'), 'Offer #' + offer.id, 'declined!');
          resolve(true)
        }
      });
    })
  }

  async function sendSellMsg(steamID, itemName, recursionCount = 0) {
    return new Promise((resolve, reject) => {
      if (recursionCount >= 5) {
        console.log(chalk.yellow('JS:'), 'Maximum recursion count reached for:', chalk.italic(steamID) + '\n');
        resolve(false);
      }
  
      setTimeout(() => {
        client.chat.sendFriendMessage(steamID, '!sell ' + itemName);
        console.log(chalk.yellow('JS:'), chalk.bold('"!sell', itemName) + '" sent to:', chalk.italic(steamID), '('+chalk.red(recursionCount+1)+')');
      }, 30000);
  
      const friendMessageHandler = (steamID, message) => {
        client.removeListener(`friendMessage#${steamID}`, friendMessageHandler);
        if (message.includes('❌') || message.includes('fail') || message.includes('find') || message.includes('Issue')) {
          resolve(sendSellMsg(steamID, itemName, recursionCount + 1));
        } else {
          console.log(message)
          console.log(chalk.yellow('JS:'), chalk.bold('Success, bot creating offer...'))
          client.chat.sendFriendMessage(steamID, '!checkout');
          resolve(true)
        }
      };
      client.on(`friendMessage#${steamID}`, friendMessageHandler);
  }
)} 
  

  let activeListings = {};
  manager.on('newOffer', async (offer) => {
    console.log('\n'+chalk.yellow('JS:'), chalk.bold('New offer #' + offer.id));
    const regex = /([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)/;
    const results = [];

    const rl = readline.createInterface({
      input: fs.createReadStream('TradeOffers.csv'),
      output: process.stdout,
      terminal: false
    });

    rl.on('line', async (line) => {
      const [, name, buyPrice, listingsStr, keyPrice, scrapTF, isBot] = line.match(regex);
      const listings = JSON.parse(listingsStr.replace(/'/g, "\""));

      results.push({
        name,
        buyPrice: parseInt(buyPrice),
        listings,
        keyPrice: parseInt(keyPrice),
        scrapTF: scrapTF === 'True',
        isBot: isBot.trim() === 'True'
      });
    });
  
    rl.on('close', async () => {
      let [giveCountScrap, giveCountRec, giveCountRef, giveCountKey] = [0, 0, 0, 0];
      let [getCountScrap, getCountRec, getCountRef, getCountKey] = [0, 0, 0, 0];
      let itemName;
      let giving;
    
      for (let item of offer.itemsToGive) {
        if (item.name === 'Scrap Metal') {
          giveCountScrap+=1;
        } else if (item.name === 'Reclaimed Metal') {
          giveCountRec+=1;
        } else if (item.name === 'Refined Metal') {
          giveCountRef+=1;
        } else if (item.name === 'Mann Co. Supply Crate Key') {
          giveCountKey+=1;
        } else {
          giving = true;
          itemName = item.name;
        }
      }
  
      for (let item of offer.itemsToReceive) {
        if (item.name === 'Scrap Metal') {
          getCountScrap+=1;
        } else if (item.name === 'Reclaimed Metal') {
          getCountRec+=1;
        } else if (item.name === 'Refined Metal') {
          getCountRef+=1;
        } else if (item.name === 'Mann Co. Supply Crate Key') {
          getCountKey+=1;
        } else {
          if (giving) {
            //Handle the case where there might be items that aren't pure on both sides?
          }
          giving = false;
          itemName = item.name;
        }
      }
      
      for (let listing of results) {
        if ((listing.name).includes(itemName) || itemName.includes(listing.name)) {
          const pure = Math.abs(giveCountScrap - getCountScrap + (giveCountRec - getCountRec)*3 + (giveCountRef - getCountRef)*9 + (giveCountKey - getCountKey)*listing.keyPrice);

          amtKey = Math.floor(pure / listing.keyPrice);
          amtRef = ((pure % listing.keyPrice)/9).toFixed(3).substring(0,5);
          if (amtRef < 10) {
            amtRef = amtRef.substring(0,4);
          }
        
          if (giving) {
            console.log(chalk.yellow('JS:'), chalk.bold('GIVING'), chalk.italic(itemName), chalk.bold('FOR'), 
            (amtKey !== 0 ? chalk.italic(amtKey, 'keys ') : '') +
            (amtRef !== 0 ? chalk.italic(amtRef, 'ref') : '') + '\n'
            );

            if (pure >= listing.buyPrice) {
              console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.green('\nReceiving:', chalk.italic(pure), '\nbuyPrice:', chalk.italic(listing.buyPrice), chalk.bold('\nAccepting offer...\n')));
              await acceptOffer(offer);

              console.log(chalk.yellow('JS:'), 'Removing', chalk.bold(itemName), 'from activeListings...')
              delete activeListings[itemName]
              
            } else {
              console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.red('\nReceiving:', chalk.italic(pure), '\nbuyPrice', chalk.italic(listing.buyPrice), chalk.bold('\nDeclining offer...\n')));
              await declineOffer(offer);

              if (itemName in activeListings) {
                if (activeListings[itemName].length === 0) {
                  console.log(chalk.yellow('JS:'), chalk.bold('No active SIDS for', itemName, 'found!'))
                  console.log(chalk.yellow('JS:'), chalk.bold('Removing', itemName, 'from activeListings...'))
                  delete activeListings[itemName]
                } else {
                  while (await sendSellMsg(activeListings[itemName][0], itemName) === false) {
                    activeListings[itemName] = activeListings[itemName].slice(1)
                  }
                }
              } else {
                console.log(chalk.yellow('JS:'), chalk.bold('No active listings for', itemName, 'found!'))
                await declineOffer(offer);
              }
            }

          } else {
            console.log(chalk.yellow('JS:'), chalk.bold('RECEIVING'), chalk.italic(itemName), chalk.bold('FOR'), 
            (amtKey !== 0 ? chalk.italic(amtKey, 'keys ') : '') +
            (amtRef !== 0 ? chalk.italic(amtRef, 'ref') : '') + '\n');

            if (pure <= listing.buyPrice) {
              console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.green('\nPaying:', chalk.italic(pure),  '\nbuyPrice:', chalk.italic(listing.buyPrice), chalk.bold('\nAccepting offer...\n')));
                  
              await acceptOffer(offer);
              const activeSIDS = Object.keys(listing.listings);
              activeListings[itemName] = activeSIDS
              while (await sendSellMsg(activeListings[itemName][0], itemName) === false) {
                activeListings[itemName] = activeListings[itemName].slice(1)
              }
  
            } else {
              console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.red('\nPaying:', chalk.italic(pure), '\nbuyPrice', chalk.italic(listing.buyPrice), chalk.bold('\nDeclining offer...\n')));
              await declineOffer(offer);
            }
          }
        }
      }
    });
  })
});