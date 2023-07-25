function sendSellMsg(SID, itemName) {
  console.log(SID);
  return new Promise((resolve) => {
    setTimeout(() => {
      if (SID === 1) {
        console.log('yo');
        resolve(true);
      } else {
        resolve(false);
      }
    }, 5000);
  });
}

let activeListings = {};
const itemName = 'test';
activeListings[itemName] = [2, 3, 1];

async function yo() {
  while (await sendSellMsg(activeListings[itemName][0], itemName) === false) {
    console.log(activeListings);
    activeListings[itemName] = activeListings[itemName].slice(1);
  }
}

yo();
