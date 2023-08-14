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


let finished = {};
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
        console.log(chalk.yellow('JS:'), 'User is already a friend! Testing if online...');
        checkResponseTime(client, steamID)
          .then(resolve)
          .catch(reject);

      } else if (err) {
        console.log(chalk.yellow('JS:'), 'Error adding friend:', chalk.red(err.message));
        resolve(false);
      } else {
        console.log(chalk.yellow('JS:'), 'Friend request sent! Waiting for response...');
        timer = setTimeout(() => {
          if (client.myFriends[steamID] === SteamUser.EFriendRelationship.RequestRecipient) {
            console.log(chalk.yellow('JS:'), 'User did not respond in time -> Removing friend');
            client.removeFriend(steamID);
            resolve(false);
          } else if (client.myFriends[steamID] === SteamUser.EFriendRelationship.Friend) {
            console.log(chalk.yellow('JS:'), 'User accepted friend request! Testing if online...');
            checkResponseTime(client, steamID)
              .then(resolve)
              .catch(reject);
          } else {
            resolve(false)
          }
        }, 5000);
      }
    });

    
    // Check if user accepted friend request:
    client.on(`friendRelationship#${steamID}`, (steamID, relationship) => {
      client.removeAllListeners(`friendRelationship#${steamID}`);
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
  return new Promise(async (resolve, reject) => {
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
      )  {
        console.log(chalk.yellow('JS:'), chalk.green('User has enough pure!'));
        const attributes = parseString(name, true, true);
        if (!itemCounts.hasOwnProperty(toSKU(attributes))) { // Check if bot already has item!
          console.log(chalk.yellow('JS:'), chalk.green('User does not have item!'));
          resolve(true);
        } else {
          console.log(chalk.yellow('JS:'), chalk.red('User already has item!'));
          resolve(false);
        }
      } else {
        console.log(chalk.yellow('JS:'), chalk.red('User does not have enough pure!'));
        resolve(false);
      } 
    } catch (error) {
      if (retryCount < 100) {
        retryCount++;
        console.error('fetchInventory:', chalk.red(error.message), '-', 'Retrying in', chalk.yellow('100ms'));
        await new Promise((resolve) => setTimeout(resolve, 100)); // Adjust the delay as needed
        resolve(checkInventory(steamID, price, name, keyPrice, retryCount)); // Recursive call to repeat the function
      } else {
        console.log(chalk.yellow('JS:'),'Exceeded maximum retry limit. Skipping checkInventory.');
        resolve(false);
      }
    }
  })
}

async function update_csv(lineToModify, botListings, action, inp, out) {
  return new Promise((resolve, reject) => {
    const regex = /([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)/;
    let displayName = '';

    const rl = readline.createInterface({
      input: fs.createReadStream(inp),
      output: fs.createWriteStream('temp.csv'),
      terminal: false
    });

    rl.on('line', (line) => {
      if (line === lineToModify && action === 'isBot') {
        const [, name, buyPrice, listingsStr, keyPrice, scrapTF, isBot] = line.match(regex);
        const strListings = JSON.stringify(botListings); //Converting object to string dict
        const modifiedLine = `${name},${buyPrice},${strListings},${keyPrice},${scrapTF},True`;

        fs.appendFile(out, modifiedLine + '\n', (err) => {
          if (err) {
            console.error('Error appending to buyItem.csv:', err);
          }
        console.log('\n'+chalk.yellow('JS:'), chalk.greenBright('Added'), chalk.bold(name), 'to', out + '!')
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
        fs.unlink(inp, (unlinkErr) => {
          if (unlinkErr) {
            console.error('Error unlinking file:', unlinkErr);
            reject(unlinkErr);
          } else if (action === 'del') {
            fs.rename('temp.csv', out, (renameErr) => {
              if (renameErr) {
                console.error('Error renaming file:', renameErr);
                reject(renameErr);
              } else if (action === 'del') {
                console.log(chalk.yellow('JS:'), chalk.red('Removed'), chalk.bold(displayName), 'from', inp + '!\n');
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
        resolve()
      } else {
        console.log('\n'+chalk.yellow('JS:'), chalk.bold('listings.csv changed. Processing...'));
        console.log(chalk.yellow('JS:'), 'CSV file read.', chalk.bold(results.length, 'item(s) found'));

        for (const result of results) {
          if (result['isBot']) {
            console.log(chalk.yellow('JS:'), 'Skipping row:', chalk.bold(result['name']));
            continue;
          }
          console.log('\n'+chalk.blueBright('------'),chalk.bold(result['name']),chalk.blueBright('------'));

          let sortedListings = Object.entries(result['listings']).sort((a, b) => b[1][0] - a[1][0]);
          for (const [key, value] of sortedListings) {
            let retryCount = 0;
            if (Object.keys(botListings).length === 3) {
              console.log('\n' + chalk.yellow('JS:'), chalk.greenBright('Sufficient botListings. Continuing...'))
              break;
            }
            const [steamID, sellPrice] = [key, value[0]];
            console.log('\n' + chalk.green(chalk.underline(steamID)));

            try {
              const res = await checkBot(client, steamID);
              if (res === true && sellPrice > result['buyPrice']) {
                console.log(chalk.yellow('JS:'), chalk.green('User is bot:', res));
                //console.log(chalk.yellow('JS:'), "Checking user's inventory...");
                //const hasInventory = await checkInventory(steamID, sellPrice, result['name'], result['keyPrice'], retryCount);
                const hasInventory = true
                if (hasInventory === true) {
                  console.log(chalk.yellow('JS:'), 'Pushing user to botListings...');
                  botListings[steamID.toString()] = value;
                  //break; If only want to check the first listing
                } else {
                  console.log(chalk.yellow('JS:'), 'Not pushing user to botListings...');
                }
              } else {
                console.log(chalk.yellow('JS:'), chalk.red('User is bot:', res));
                continue
              }
            } catch (error) {
              console.log(chalk.yellow('JS:'), chalk.red('User is bot:', error));
              continue
            }
          }
          if (Object.keys(botListings).length >= 2) {
            await update_csv(lineMod, botListings, 'isBot', 'listings.csv', 'buyItem.csv')
            await update_csv(lineMod, botListings, 'del', 'listings.csv', 'listings.csv')
            
          } else {
            await update_csv(lineMod, botListings, 'del', 'listings.csv', 'listings.csv')
          }
        }
      }
      resolve(false)
    });
      rl.on('error', error => {
        console.error(chalk.yellow('JS:'), 'Error reading CSV file:', error);
        reject(false);
    });
  });
}

function getInventories(SID,manager,listing) {
  return new Promise((resolve, reject) => {
    setTimeout(() => { 
      let partnerItems = {'Keys': [], 'Ref': [], 'Rec': [], 'Scrap': []};
      let ownItems = {'itemObj': [], 'Keys': [], 'Ref': [], 'Rec': [], 'Scrap': []};

      const priceDict = listing.listings[SID][1] //Gives the price dict that bot is buying at
      const metal = "metal" in priceDict ? priceDict["metal"] : 0;
      const amtKeys = "keys" in priceDict ? priceDict["keys"] : 0;
      const amtRef = Math.floor(metal);
      const amtRec = Math.floor((metal % 1)/0.33);
      const amtScrap = Math.round(((metal % 1) % 0.33)/0.11);

      manager.getUserInventoryContents('76561199246529800',440,2,true,(err,inventory)=>{
        if (err) {
          console.log(chalk.yellow('JS:'), chalk.red('Error getting own inventory:', err.message));
          resolve(false)
        } else {
          for (const item of inventory) {
            if (item.name === 'Mann Co. Supply Crate Key') {
              ownItems['Keys'].push(item);
            } else if (item.name === 'Refined Metal') {
              ownItems['Ref'].push(item);
            } else if (item.name === 'Reclaimed Metal') {
              ownItems['Rec'].push(item);
            } else if (item.name === 'Scrap Metal') {
              ownItems['Scrap'].push(item);
            } else if ((item.name).includes(listing.name) || (listing.name).includes(item.name)) {
              ownItems['itemObj'].push(item);
              break;
            }
          }
          if (ownItems['itemObj'].length === 0) {
            console.log(chalk.yellow('JS:'), chalk.red('Error getting own inventory:', 'No', chalk.bold(listing.name), 'found'));
            resolve(false)
          } else {
            console.log('\n'+chalk.yellow('JS:'), chalk.green('Own Inventory fetched!'));
          }
          //Get a specific user's inventory
          manager.getUserInventoryContents(SID,440,2,true,(err,inventory)=>{
            if (err) {
              console.log(chalk.yellow('JS:'), chalk.red('Error getting partner inventory:', err.message));
              resolve(false)
            } else {
              console.log(chalk.yellow('JS:'), chalk.green('Partner Inventory fetched!'));
              for (const item of inventory) {
                if (partnerItems['Keys'].length >= amtKeys && 
                  partnerItems['Ref'].length >= amtRef && 
                  partnerItems['Rec'].length >= amtRec && 
                  partnerItems['Scrap'].length >= amtScrap) {
                  break;
                }

                if (item.name === 'Mann Co. Supply Crate Key') {
                  partnerItems['Keys'].push(item);
                } else if (item.name === 'Refined Metal') {
                  partnerItems['Ref'].push(item);
                } else if (item.name === 'Reclaimed Metal') {
                  partnerItems['Rec'].push(item);
                } else if (item.name === 'Scrap Metal') {
                  partnerItems['Scrap'].push(item);
                }
              }
              resolve({'partnerItems': partnerItems, 'ownItems': ownItems})
            }
          });
        }
      });
    }, 2000);
  });
}

getRefreshToken(async (refreshToken, client, cookies) => {
  console.log(chalk.yellow('JS:'), 'Watching listings.csv for changes...');
  const listingsWatcher = chokidar.watch('listings.csv');
  let listingsProcessing = false;
  let listingsQueue = [];

  async function queueManager() {
    while (listingsQueue.length > 0) {
      listingsProcessing = true;
      listingsQueue.shift();
      await processCSV(client);
      listingsProcessing = false;
    }
  }

  listingsWatcher.on('change', async (path) => {
    listingsQueue.push('c');
    if (!listingsProcessing) {
      queueManager();
    } else {
      console.log(chalk.yellow('JS:'), chalk.bold(chalk.redBright('Already processing CSV file!\n')));
    }
  });
  
  const community = new SteamCommunity();
  const manager = new TradeOfferManager({
    steam: client,
    community: community,
    language: 'en'
  }); 

  async function constructOffer(SID, listing, pure) {
    return new Promise(async (resolve, reject) => {
      let actualBuy = scrapToPure(pure, listing.keyPrice)
      let buyPrice = scrapToPure(listing.buyPrice, listing.keyPrice)

      const priceDict = listing.listings[SID][1] //Gives the price dict that bot is buying at
      const metal = "metal" in priceDict ? priceDict["metal"] : 0;
      const amtKeys = "keys" in priceDict ? priceDict["keys"] : 0;
      const amtRef = Math.floor(metal);
      const amtRec = Math.floor((metal % 1)/0.33);
      const amtScrap = Math.floor(Math.round(((metal % 1) % 0.33)/0.11));
      
      let retries = 0;
      while (true) {
        if (retries >= 30) {
          console.log(chalk.yellow('JS:'), chalk.red('Error getting inventories:', 'Retried 30 times'));
          resolve(false)
        }
        const result = await getInventories(SID,manager,listing);
        if (result !== false) {
          var partnerItems = result['partnerItems']
          var ownItems = result['ownItems']
          break;
        }
        retries++
      }

      if (partnerItems['Keys'].length >= amtKeys && partnerItems['Ref'].length >= amtRef && partnerItems['Rec'].length >= amtRec && partnerItems['Scrap'].length >= amtScrap) {
        console.log(chalk.yellow('JS:'), chalk.green('Bot has enough pure without adjustments!\n'))
        let offer = manager.createOffer(SID);
                  
        partnerItems['Keys'] = partnerItems['Keys'].slice(0,amtKeys)
        partnerItems['Ref'] = partnerItems['Ref'].slice(0,amtRef)
        partnerItems['Rec'] = partnerItems['Rec'].slice(0,amtRec)
        partnerItems['Scrap'] = partnerItems['Scrap'].slice(0,amtScrap)
                  
                  
        offer.addMyItems(ownItems['itemObj'])
        offer.addTheirItems([...partnerItems['Keys'], ...partnerItems['Ref'], ...partnerItems['Rec'], ...partnerItems['Scrap']])
        console.log('\n'+chalk.blueBright('------'), chalk.bold("New offer constructed"), chalk.blueBright('------') + '\n\n' +
        chalk.underline('itemsToGive:') + '\n' +
        ownItems['itemObj'].length + 'x', ownItems['itemObj'][0].name + '\n\n' +
        chalk.underline('itemsToReceive:') + '\n' +
        (partnerItems['Keys'].length > 0 ? partnerItems['Keys'].length + 'x ' + partnerItems['Keys'][0].name + '\n' : '') +
        (partnerItems['Ref'].length > 0 ? partnerItems['Ref'].length + 'x ' + partnerItems['Ref'][0].name + '\n' : '') +
        (partnerItems['Rec'].length > 0 ? partnerItems['Rec'].length + 'x ' + partnerItems['Rec'][0].name + '\n' : '') +
        (partnerItems['Scrap'].length > 0 ? partnerItems['Scrap'].length + 'x ' + partnerItems['Scrap'][0].name : '') + '\n\n' +
        chalk.dim(chalk.underline('actualBuy:')) + '\n' +
        chalk.dim(actualBuy[0] !== 0 ? actualBuy[0] + 'x Mann Co. Supply Crate Key' + '\n' : '') +
        chalk.dim(actualBuy[1] !== 0 ? actualBuy[1] + 'x Refined Metal' + '\n' : '') +
        chalk.dim(actualBuy[2] !== 0 ? actualBuy[2] + 'x Reclaimed Metal' + '\n' : '') +
        chalk.dim(actualBuy[3] !== 0 ? actualBuy[3] + 'x Scrap Metal' + '\n' : '') + '\n' +
        chalk.blueBright('-----------------------------------')+ '\n'
        ); 
             
        offer.send(async function(err, status) {
          console.log(chalk.yellow("JS:"), "Offer #" + chalk.bold(offer.id), "- sent")
          manager.on('sentOfferChanged', function(offer, oldState) { 
            if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${chalk.blueBright(TradeOfferManager.ETradeOfferState[oldState])} -> ${chalk.greenBright(TradeOfferManager.ETradeOfferState[offer.state])}`);
              manager.removeAllListeners('sentOfferChanged');
              resolve(true);
            } else if (offer.state === TradeOfferManager.ETradeOfferState.Declined) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${chalk.blueBright(TradeOfferManager.ETradeOfferState[oldState])} -> ${chalk.redBright(TradeOfferManager.ETradeOfferState[offer.state])}`);
              manager.removeAllListeners('sentOfferChanged');
              resolve(false);
            } else if (offer.state === TradeOfferManager.ETradeOfferState.Active) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${chalk.magenta(TradeOfferManager.ETradeOfferState[oldState])} -> ${chalk.blueBright(TradeOfferManager.ETradeOfferState[offer.state])}`);
            } else if (offer.state === TradeOfferManager.ETradeOfferState.Countered) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${chalk.magenta(TradeOfferManager.ETradeOfferState[oldState])} -> ${chalk.yellow(TradeOfferManager.ETradeOfferState[offer.state])}`);
              manager.removeAllListeners('sentOfferChanged');
              resolve(false)
            } else if (offer.state === TradeOfferManager.ETradeOfferState.InvalidItems) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${chalk.blueBright(TradeOfferManager.ETradeOfferState[oldState])} -> ${chalk.redBright(TradeOfferManager.ETradeOfferState[offer.state])}`);
              manager.removeAllListeners('sentOfferChanged');
              resolve(false)
            } else {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
            }
          });
          if (err) {
            console.log(err.message);
            resolve(false)
          }
          if (status === 'pending') {
            community.acceptConfirmationForObject(config.STEAM_IDENTITY_SECRET, offer.id, async function(err) {
              if (err) {
                console.log(chalk.yellow('JS:'), 'Offer #'+chalk.bold(offer.id), "-", chalk.redBright("Error accepting confirmation:", err.message));
              } else {
                console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), "-", chalk.greenBright("confirmation accepted!"))
              }  
            });
          } else {
            console.log(chalk.yellow("JS:"),`Offer #${chalk.bold(offer.id)} - sent successfully`)
          }
        });
      } else {
        console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.redBright('does not have specific amount of pure!'))
        const diff = {"Keys":amtKeys - partnerItems['Keys'].length, "Ref":amtRef - partnerItems['Ref'].length, "Rec":amtRec - partnerItems['Rec'].length, "Scrap":amtScrap - partnerItems['Scrap'].length}
        if (diff["Keys"]*listing.keyPrice + diff["Ref"]*9 + diff["Rec"]*3 + diff["Scrap"] >= 0) {
          console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.greenBright('has enough pure in total!'))
          await adjustPure(diff, listing.keyPrice)
        } else {
          console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.redBright('does not have enough pure in total!'))
          resolve(false)
        }
        console.log(partnerItems['Keys'].length, amtKeys, partnerItems['Ref'].length, amtRef, partnerItems['Rec'].length, amtRec, partnerItems['Scrap'].length, amtScrap)
        resolve(false)
      }
      async function adjustPure(diff, keyPrice) {
        return new Promise(async (resolve, reject) => {
          let added = [0,0,0,0] //Keys, Ref, Rec, Scrap that trade partner needs to add
          let removed = [0,0,0,0] //Keys, Ref, Rec, Scrap that trade partner needs to remove
          if (diff["Keys"] > 0) { //Trade partner has insufficient keys
            let updateAdded = await scrapToPure(diff["Keys"] * keyPrice,1000000); //High keyPrice since we only want to convert keys to other metals
            added = added.map((value,index) => value + updateAdded[index]);
            removed = [diff["Keys"], removed[1], removed[2], removed[3]]
            if (added[1] + diff["Ref"] <= 0 && added[2] + diff["Rec"] <= 0 && added[3] + diff["Scrap"] <= 0) { //Trade partner has enough ref, rec, scrap to cover the keys
              console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '- replacing', diff["Keys"]+'x keys with',added[1]+"x ref,", added[2]+"x rec,", added[3]+"x scrap!");
              resolve(added, removed)
            } else {
              const metal = [added[1]+diff["Ref"], added[2]+diff["Rec"], added[3]+diff["Scrap"]] //Negative means trade partner has more than sufficient
              for (const [index, value] of metal.entries()) {
                if (value > 0) {
                  if (index === 0) {
                    console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.redBright('does not have enough ref to cover keys!'));
                    if (metal[0]*3 + metal[1] <= 0) { //Check if rec can cover the remaining ref
                      console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '- replacing', metal[0]+"x ref with",metal[0]*3+"x rec!");
                      added = [added[0], added[1], added[2] + metal[0]*3, added[3]]
                      resolve(added, removed)
                    } else {
                      console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.redBright('does not have enough ref/rec to cover keys!'));
                      console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '- replacing', metal[0]+"x ref with",-metal[1]+"x rec,", metal[0]*9+metal[1]*3+"x scrap!");
                      added = [added[0], added[1], added[2] + metal[1], added[3] + metal[0]*9+metal[1]*3]
                      resolve(added, removed)
                    }
                  } else if (index === 1) {
                    console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '-', chalk.redBright('does not have enough rec to cover keys!'));
                    if (metal[1]*3 + metal[2] <= 0) { //Check if scrap can cover the remaining needed rec
                      console.log(chalk.yellow('JS:'), 'Trade partner:', chalk.bold(SID), '- replacing', metal[1]+"x rec with",metal[1]*3+"x scrap!");
                      added = [added[0], added[1], added[2], added[3] + metal[1]*3]
                      resolve(added, removed)
                    } else {
                      console.log("Sum ting wong, not enough pure!")
                      resolve(false)
                    }
                  } else {
                    console.log("Sum ting wong, not enough pure (2)!")
                    resolve(false)
                  }
                }
              }
            }
          
          } else if (diff["Ref"] > 0) { //Trade partner has insufficient ref
            
          } else if (diff["Rec"] > 0) { //Trade partner has insufficient rec
            
          } else if (diff["Scrap"] > 0) { //Trade partner has insufficient scrap
            
          }
        })
      }
    });
  }
  //cookies from webSession
  manager.setCookies(cookies);
  community.setCookies(cookies);
  community.startConfirmationChecker(5000, config.STEAM_IDENTITY_SECRET);

  async function acceptOffer(offer) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        offer.accept((err) => {
          if (err) {
            if ((err.message).includes('not active')){
              resolve(true)
            }
            console.log(chalk.yellow('JS:'), chalk.red('Error accepting offer:', err.message))
            resolve(acceptOffer(offer));
          } else {
            community.checkConfirmations();
            const receivedOfferChangedListener = function (offer, oldState) {
              console.log(chalk.yellow('JS:'), `Offer #` + chalk.bold(offer.id), `changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
              manager.removeListener('receivedOfferChanged', receivedOfferChangedListener);
              if (offer.state === TradeOfferManager.ETradeOfferState.Accepted) {
                console.log(chalk.yellow('JS:'), chalk.greenBright('Offer #' + chalk.bold(offer.id), 'accepted!\n'));
                resolve(true);
              } else if (offer.state === TradeOfferManager.ETradeOfferState.InvalidItems) {
                console.log(chalk.yellow('JS:'), chalk.redBright('Offer #' + chalk.bold(offer.id), 'invalid items!\n'));
                resolve(false);
              }
            };
            manager.on('receivedOfferChanged', receivedOfferChangedListener);
          }
        });
      }, 2000);
    })
  }

  async function declineOffer(offer) {  
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        offer.decline((err) => {
          if (err) {
            if ((err.message).includes('not active')){
              resolve(true)
            }
            console.log(chalk.yellow('JS:'), chalk.red('Error declining offer:', err.message));
            resolve(declineOffer(offer));
          } else {
            const receivedOfferChangedListener = function (offer, oldState) {
              console.log(`Offer #`+chalk.bold(offer.id), `changed: ${TradeOfferManager.ETradeOfferState[oldState]} -> ${TradeOfferManager.ETradeOfferState[offer.state]}`);
              if (offer.state == TradeOfferManager.ETradeOfferState.Declined) {
                console.log(chalk.yellow('JS:'), 'Offer #' + chalk.bold(offer.id), 'declined!');
                manager.removeListener('receivedOfferChanged', receivedOfferChangedListener);
                resolve(true)
              }
            };
            manager.on('receivedOfferChanged', receivedOfferChangedListener);
          }
        });
      }, 2000);
    })
  }

  async function sendSellMsg(steamID, itemName, recursionCount = 0) {
    //Not working correctly, check problem
    return new Promise((resolve, reject) => {
      if (finished[itemName]) {
        resolve({result: true, recursionCount: recursionCount});
      }

      setTimeout(() => {
        client.chat.sendFriendMessage(steamID, '!sell ' + itemName);
        console.log(chalk.yellow('JS:'), chalk.bold('"!sell', itemName) + '" sent to:', chalk.italic(steamID), '(' + chalk.red(recursionCount + 1) + ')');
      }, 30000);

      const friendMessageHandler = async (steamID, message) => {
        client.removeListener(`friendMessage#${steamID}`, friendMessageHandler);
        if (finished[itemName]) {
          return;
        }

        if (recursionCount >= 5) {
          finished[itemName] = true;
          console.log(chalk.yellow('JS:'), chalk.redBright('Maximum recursion count reached for:', chalk.italic(steamID)) + '\n');
          resolve({ result: false, recursionCount: recursionCount });

        } else if (message.includes('[/tradeoffer]')) {
          finished[itemName] = true;
          console.log(chalk.yellow('JS:'), chalk.greenBright('Success, bot creating offer...'))
          resolve({ result: true, recursionCount: recursionCount });

        } else {
          resolve(await sendSellMsg(steamID, itemName, recursionCount + 1));
        }
      };
      client.on(`friendMessage#${steamID}`, friendMessageHandler);
    });
  }
  
  let offerQueue = [];
  let activeListings = {};
  let processingOffer = false;

  async function offerManager(offer) {
    while (offerQueue.length > 0) {
      offerQueue.shift();
      processingOffer = true;
      await processOffer(offer)
      processingOffer = false;
    }
  }

  manager.on('newOffer', async (offer) => {
    offerQueue.push(offer);
    if (!processingOffer) {
      const nextOffer = offerQueue[0]
      offerManager(nextOffer);
    } else {
      console.log(chalk.yellow('(!)'), "New Offer Incoming - Added To offerQueue", chalk.yellow('(!)') )
    }
  });

  async function processOffer(offer) {
    return new Promise((resolve, rejct) => {
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
          isBot: isBot.trim() === 'True',
          line
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
                  
                console.log(chalk.yellow('JS:'), chalk.red('Removed'), chalk.bold(itemName), 'from activeListings...')
                await update_csv(listing.line, {}, 'del', 'tradeOffers.csv', 'tradeOffers.csv')
                delete activeListings[itemName]
              } else {
                console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.red('\nReceiving:', chalk.italic(pure), '\nbuyPrice', chalk.italic(listing.buyPrice), chalk.bold('\nDeclining offer...\n')));
                await declineOffer(offer);

                if (itemName in activeListings) {
                  if (activeListings[itemName].length === 0) {
                    console.log(chalk.yellow('JS:'), chalk.bold('No active SIDS for', chalk.bold(itemName), 'found!'))
                    console.log(chalk.yellow('JS:'), chalk.red('Removing'),chalk.bold(itemName), 'from activeListings...')
                    delete activeListings[itemName]

                    console.log(chalk.yellow('JS:'), chalk.red('Removing'), chalk.bold(itemName), 'from TradeOffers.csv...')
                    await update_csv(listing.line, {}, 'del', 'tradeOffers.csv', 'tradeOffers.csv')
                  } else {
                    let i = 0;
                    for (const SID of activeListings[itemName]) {
                      const result = await sendSellMsg(SID, itemName);
                      if (result.result === true) {
                        activeListings[itemName] = activeListings[itemName].slice(i+1)
                        break;
                      } else if (result.recursionCount >= 5) {
                        continue;
                      }
                      finished[itemName] = false;
                      i++;
                    }
                  }
                } else {
                  console.log(chalk.yellow('JS:'), 'No active listings for', chalk.bold(itemName), 'found!')
                  await declineOffer(offer);
                }
              }

            } else {
              console.log(chalk.yellow('JS:'), chalk.bold('RECEIVING'), chalk.italic(itemName), chalk.bold('FOR'), 
              (amtKey !== 0 ? chalk.italic(amtKey, 'keys ') : '') +
              (amtRef !== 0 ? chalk.italic(amtRef, 'ref') : '') + '\n');

              if (pure <= listing.buyPrice) {
                console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name, "#"+chalk.bold(offer.id))), chalk.green('\nPaying:', chalk.italic(pure),  '\nbuyPrice:', chalk.italic(listing.buyPrice), chalk.bold('\nAccepting offer...\n')));
                      
                await acceptOffer(offer);
                const activeSIDS = Object.keys(listing.listings);
                activeListings[itemName] = activeSIDS
                  
                  
                let i = 0;
                for (const SID of activeListings[itemName]) {
                  const startTime = Date.now();
                  let result = await constructOffer(SID, listing, pure)
                  const endTime = Date.now();
                  const elapsedTime = (endTime - startTime)/1000;
                  if (elapsedTime > 100 && activeListings[itemName].length > 1) {
                    console.log(chalk.yellow("(!)"),"Offer not finished within 100seconds, aborting!",chalk.yellow("(!)"))
                  }

                  if (result === true) {
                    console.log("\n" + chalk.yellow("JS:"), chalk.greenBright("Completed"), chalk.bold(itemName), "in", chalk.bold(elapsedTime) + " seconds!")
                    activeListings[itemName] = activeListings[itemName].slice(i+1)
                    break;
                  }
                  i++
                }
                console.log(chalk.yellow('JS:'), chalk.red('Removed'), chalk.bold(itemName), 'from activeListings...')
                await update_csv(listing.line, {}, 'del', 'tradeOffers.csv', 'tradeOffers.csv')
                delete activeListings[itemName]
                resolve()

              } else {
                console.log(chalk.underline(chalk.yellow("JS:"), chalk.bold(listing.name)), chalk.red('\nPaying:', chalk.italic(pure), '\nbuyPrice', chalk.italic(listing.buyPrice), chalk.bold('\nDeclining offer...\n')));
                await declineOffer(offer);

                console.log(chalk.yellow('JS:'), 'Removing', chalk.bold(itemName), 'from TradeOffers.csv...')
                await update_csv(listing.line, {}, 'del', 'tradeOffers.csv', 'tradeOffers.csv')
                resolve()
              }
            }
          }
        }
      });
    });
  }
});
