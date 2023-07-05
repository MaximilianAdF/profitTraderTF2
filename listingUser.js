const { parseString } = require('tf2-item-format/static');
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
    callback(refreshToken, client);
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
        reject(false);
      }
    }, 3000);

    function handleFriendMessage(steamIDreceive, message) {
      const deltaTime = Date.now() - startTime;
      console.log(chalk.yellow('JS:'), 'Response Time:', deltaTime, 'ms!');
      clearTimeout(timer);
      resolved = true;
      resolve(true);

      // Remove the event listener after it has been triggered
      client.removeListener(`friendMessage#${steamID}`, handleFriendMessage);
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
        reject(false);
      } else {
        console.log(chalk.yellow('JS:'), 'Friend request sent! Waiting for response...');
        timer = setTimeout(() => {
          console.log(chalk.yellow('JS:'), 'User did not respond in time -> Removing friend');
          client.removeFriend(steamID);
          reject(false);
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

async function checkInventory(steamID, price, name, keyPrice) {
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
    //console.error('fetchInventory:', chalk.red(error.message), '-', 'Retrying in', chalk.yellow('100ms'));
    await new Promise((resolve) => setTimeout(resolve, 100)); // Adjust the delay as needed
    return checkInventory(steamID, price, name, keyPrice); // Recursive call to repeat the function
  }
}

function incomingTrade(buyPrice, name, keyPrice) {
  const brah = 1
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
        const modifiedLine = `${name},${buyPrice},${botListings},${keyPrice},${scrapTF},True`;

        fs.appendFile('TradeOffers.csv', modifiedLine + '\n', (err) => {
          if (err) {
            console.error('Error appending to TradeOffers.csv:', err);
          }
        console.log(chalk.yellow('JS:'), chalk.bold(name), 'added to TradeOffers.csv!\n')
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

    let botListings = [];
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
      console.log(chalk.yellow('JS:'), 'CSV file read.', chalk.bold(results.length, 'item(s) found'));

      for (const result of results) {
        if (result['isBot']) {
          console.log(chalk.yellow('JS:'), 'Skipping row:', chalk.bold(result['name']));
          continue;
        }

        let sortedListings = Object.entries(result['listings']).sort((a, b) => b[1] - a[1]);
        for (const [key, value] of sortedListings) {
          if (botListings.length === 2) {
            console.log('\n' + chalk.yellow('JS:'), chalk.greenBright('Sufficient botListings. Continuing...'))
            break;
          }
          const [steamID, sellPrice] = [key, value];
          console.log('\n' + chalk.green(chalk.underline(steamID)));

          try {
            const res = await checkBot(client, steamID);
            if (res === true && sellPrice > result['buyPrice']) {
              console.log(chalk.yellow('JS:'), chalk.green('User is bot:', res,'\n'));
              console.log(chalk.yellow('JS:'), "Checking user's inventory...");
              const hasInventory = await checkInventory(steamID, sellPrice, result['name'], result['keyPrice']);
              if (hasInventory === true) {
                console.log(chalk.yellow('JS:'), 'Pushing user to botListings...');
                botListings.push([steamID, sellPrice]);
                //break;
              } else {
                console.log(chalk.yellow('JS:'), 'Not pushing user to botListings...');
              }
            } else {
              console.log(chalk.yellow('JS:'), chalk.red('User is bot:', res,'\n'));
            }
          } catch (error) {
            console.log(chalk.yellow('JS:'), chalk.red('User is bot:', error,'\n'));
            continue
          }
        }
        if (botListings.length > 0) {
          await update_csv(lineMod, botListings, 'isBot')
          resolve(true);
        } else {
          await update_csv(lineMod, botListings, 'del')
          resolve('0listings'); // Return if 0 bot listings 
        }
      }
      resolve('skipping');
    });
    rl.on('error', error => {
      console.error(chalk.yellow('JS:'), 'Error reading CSV file:', error);
      reject(error);
    });
  });
}

getRefreshToken(async (refreshToken, client) => {
  const watcher = chokidar.watch('listings.csv');
  let isProcessing = false;
  let queueCounter = 0;
  const queue = [];


  async function queueManager(queue) {
    if (!isProcessing || queue.length === 0) {
      queueCounter++;
      console.log(chalk.yellow('JS:'), chalk.bold(`Processing queue item: ${queueCounter}`));
      isProcessing = true;
      const res = await processCSV(client);
      isProcessing = false;
      queue.shift();

      //Handle res

      if (queue.length > 0) {
        queueManager(queue);
      } else {
        return;
      }
    } else if (isProcessing) {
      console.log(chalk.yellow('JS:'), chalk.bold(chalk.redBright('Already processing CSV file!\n')));
      queue.push('busy');
    }
  }

  watcher.on('change', async (path) => {
    console.log('\n\n'+chalk.yellow('JS:'), chalk.bold('CSV file changed. Processing...'));
    queue.push('busy');
    queueManager(queue);
  });
  // Trade offer csv watcher
});


