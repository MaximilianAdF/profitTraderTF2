const config = require('C:/Users/Maximilian/Documents/Scrap.tf/scrapTF/config.json');
const { parseString } = require('tf2-item-format/static');
const { createFormat } = require('tf2-item-format');
const { toSKU } = require('tf2-item-format');
const { AxiosError } = require('axios');
const puppeteer = require('puppeteer');
const SteamUser = require('steam-user');
const SteamTotp = require('steam-totp');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const SteamID = require('steamid');
const { lock } = require('lock');
const chalk = require('chalk');
const axios = require('axios');
const fs = require('fs');


const schema = require('tf2-static-schema/core');
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
    console.log(chalk.yellow('JS:'),'Logged into Steam as:', chalk.italic(config.STEAM_USERNAME), '\n');
    client.setPersona(SteamUser.EPersonaState.Online);
    client.gamesPlayed(["Making Profit", 440]);
  });

  client.on('loginKey', (loginKey) => {
    refreshToken = loginKey;
    callback(refreshToken, client);
  });
}

function checkitemsTime(client, steamID) {
  return new Promise((resolve, reject) => {
    client.chat.sendFriendMessage(steamID, '!sell');
    console.log(chalk.yellow('JS:'),'Trigger message sent to user:', chalk.italic(steamID));
    const startTime = Date.now();
    const timer = setTimeout(() => {
      console.log(chalk.yellow('JS:'),'User did not respond in time');
      reject(false);
    }, 10000);

    client.on(`friendMessage#${steamID}`, (steamIDreceive, message) => {
      const deltaitems = Date.now() - startTime;
      console.log(chalk.yellow('JS:'),'items:', deltaitems, 'ms -> User', chalk.italic(steamID), 'is a bot');
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function checkBot(client, steamID) {
  return new Promise((resolve, reject) => {
    let timer;

    // Add user to friend list:
    client.addFriend(steamID, (err, addedPersonaName) => {
      if (err && err.eresult === SteamUser.EResult.DuplicateName) {
        console.log(chalk.yellow('JS:'),'User', chalk.italic(steamID), 'is already a friend, testing if online ->');
        checkitemsTime(client, steamID)
          .then(resolve)
          .catch(reject);
      } else if (err) {
        console.log(chalk.yellow('JS:'),'Error adding friend:', err);
        reject(false);
      } else {
        console.log(chalk.yellow('JS:'),'Friend request sent:', chalk.italic(steamID));
        timer = setTimeout(() => {
          console.log(chalk.yellow('JS:'),'User did not respond in time -> Removing friend');
          client.removeFriend(steamID);
          reject(false);
        }, 10000);
      }
    });

    // Check if user accepted friend request:
    client.on(`friendRelationship#${steamID}`, (steamID, relationship) => {
      if (relationship === SteamUser.EFriendRelationship.Friend) {
        console.log(chalk.yellow('JS:'),'Friend request accepted:', chalk.italic(steamID));
        clearTimeout(timer);
        checkitemsTime(client, steamID)
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
      //Convert item to correct schema
      const format = createFormat(schema);
      console.log(format)
      const attributes = format.parseEconItem(item, true, true)

      //Convert item to SKU
      const sku = toSKU(attributes);
      console.log(sku)

      //Dictionary of items
      itemCounts[sku] = (itemCounts[sku] || 0) + 1;
    }
    console.log('\n'+chalk.yellow('JS:'),"Needed Pure:", amtKeys, amtRefined, amtReclaimed, amtScraps)
    console.log(chalk.yellow('JS:'),"User's Pure:", itemCounts[skuKey], itemCounts[skuRef], itemCounts[skuRec], itemCounts[skuScrap])

    if (
      (itemCounts.hasOwnProperty(skuScrap) && itemCounts[skuScrap] >= amtScraps) &&
      (itemCounts.hasOwnProperty(skuRec) && itemCounts[skuRec] >= amtReclaimed) &&
      (itemCounts.hasOwnProperty(skuRef) && itemCounts[skuRef] >= amtRefined) &&
      (itemCounts.hasOwnProperty(skuKey) && itemCounts[skuKey] >= amtKeys)
    ) {
      console.log(chalk.yellow('JS:'), chalk.green('User', chalk.italic(steamID), 'has enough pure'));
      const attributes = parseString(name, true, true);
      console.log(toSKU(attributes));
      if (!itemCounts.hasOwnProperty(toSKU(attributes))) { // Check if bot already has item!
        console.log(chalk.yellow('JS:'), chalk.green('User', chalk.italic(steamID), 'does not have:', chalk.bold(name)));
        return true;
      } else {
        console.log(chalk.yellow('JS:'), chalk.red('User', chalk.italic(steamID), 'already has:', chalk.bold(name)));
        return false;
      }
    } else {
      console.log(chalk.yellow('JS:'), chalk.red('User', chalk.italic(steamID), 'does not have enough pure'));
      return false;
    }
  } catch (error) {
    console.error('Failed to fetch inventory for:', chalk.italic(steamID), '- Retrying in', chalk.yellow('100ms'), error);
    await new Promise((resolve) => setTimeout(resolve, 100)); // Adjust the delay as needed
    return checkInventory(steamID, price, name, keyPrice); // Recursive call to repeat the function
  }
}

function incomingTrade(buyPrice, name, keyPrice) {
  const brah = 1
}

function processCSV(client) {
  fs.readFile('C:/Users/Maximilian/Documents/Scrap.tf/scrapTF/listings.csv', 'utf8', (err, data) => {
    if (err) {
      console.error(chalk.yellow('JS:'),'Error reading CSV file:', err);
      return;
    } else {
      const rows = data.split('\n');

      for (let i = 0; i < rows.length; i++) {
        const botListings = [];
        const columns = rows[i].split(',');
        const [name, buyPrice, listingsStr, keyPrice] = columns;
        const listings = JSON.parse(listingsStr);

        for (let j = 0; j < listings.length; j++) {
          const [steamID, sellPrice] = listings[j];

          checkBot(client, steamID)
            .then((result) => {
              if (result === true && sellPrice > buyPrice) {
                console.log(chalk.yellow('JS:'),'User', chalk.italic(steamID), 'is a bot');
                checkInventory(steamID, sellPrice, name, keyPrice).then(result => {
                  if (result === true) {
                    console.log(chalk.yellow('JS:'),'Pushing user to botListings...')
                    botListings.push([steamID, sellPrice]);
                  }
                });
              } else {
                console.log(chalk.yellow('JS:'),'User', chalk.italic(steamID), 'is not a bot');
              }
            })
            .catch((error) => {
              console.log(chalk.yellow('JS:'),'Error checking if user', chalk.italic(steamID), 'is a bot:', error);
            });
        }
        if (botListings.length > 0) {
          // Trade offer stuff
        } else {
          return; // Return if 0 bot listings
        }
      }
    }
  });
}


//getRefreshToken((refreshToken, client) => {
  //fs.watch('C:/Users/Maximilian/Documents/Scrap.tf/scrapTF/listings.csv', (eventType, filename) => {
    //if (filename) {
      //console.log(chalk.yellow('JS:'),'CSV file changed. Processing...');

      //lock.acquire(() => {
       // processCSV(client)
         // .then(() => {
           // lock.release(); // Release the lock after processing is complete
         // })
          //.catch((error) => {
           // console.error(chalk.yellow('JS:'),'Error processing CSV:', error);
           // lock.release(); // Make sure to release the lock even in case of errors
         // });
     // });
   // }
 // });
//});

checkInventory('76561199246529800', 27, "Refined Metal", 2000).then(result => {
  if (result === true) {
    console.log(chalk.yellow('JS:'),'Pushing user to botListings...')
  }
});

// Example usage
