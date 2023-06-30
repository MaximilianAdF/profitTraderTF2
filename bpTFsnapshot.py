from datetime import datetime, timedelta
from unusualEffects import particles
from dotenv import load_dotenv

import unicodedata
import requests
import math
import os



load_dotenv()
session = requests.Session()
SCRAP_PER_REF = 9
REF_PER_SCRAP = 0.11

def bump_within_hour(unix_timestamp):
    now = datetime.now()
    timestamp = datetime.fromtimestamp(unix_timestamp)
    difference = now - timestamp
    one_hour = timedelta(hours=1)
    return difference <= one_hour

def request_listings(item, keyPrice):
    KEYWORDS = ["spectral", "spectrum", "spell", "paint", "footprints", "headless", "voices", "halloween", "legacy", "level 0", "parts", "exorcism"]
    Q_DICT = {"Strange":"11", "Vintage":"3", "Genuine":"1", "Collector's":14, "Haunted":13} 
    url = 'https://backpack.tf/api/classifieds/search/v1'
    listings={0:0}


    params = {
        "appid": 440,
        "page_size": "30",
        "key": os.getenv("BPTF_API_KEY")
    }

    headers = {
        "Accept": "application/json",
        "X-Auth-Token": os.getenv("BPTF_TOKEN")
    }

    #Handle unusuals
    if "|" in item:
        effect,item = item.split("|")
        params["particle"] = particles[effect]
        params["quality"] = "5"
        params["item"] = item
        item = effect + " " + item
    #Check if item is uncraftable
    elif "Non-Craftable " in item:
        params["craftable"] = "-1"
        params["item"] = item.replace("Non-Craftable ", "")
    #Check if item is australium
    elif "Australium " in item:
        params["Australium"] = "1"
        params["item"] = " ".join(item.split(" ")[2:]) #Remove "Strange" & "Australium" from the name
    #Check the quality of the item
    elif item.split(" ")[0] in Q_DICT and "Part:" not in item:
        params["quality"] = Q_DICT[item.split(" ")[0]]
        params["item"] = " ".join(item.split(" ")[1:]) #Remove prefix from the name 
    #Else item is unique
    else:
        params["quality"] = "6"
        params["item"] = item


    response = session.get(url, params=params, headers=headers)
    try:
        if response.status_code == 200:
            data = response.json()
            if data['total'] == 0: #Check if the api returned any listings
                return "name" #Add or remove "The " from the name
            
            for l in data['buy']['listings']:
                if "automatic" not in l: #Check if listing is automatic
                    continue
                if not bump_within_hour(l['bump']): #Check if listing was bumped within the last hour
                    continue
                if 'attributes' in l['item'] and len(l['item']['attributes']) > 1 and "particle" not in params: #Check if item has any attributes (Paints etc.)
                    continue
                if any(keyword in unicodedata.normalize('NFKD', l['details']).encode('ascii','ignore').decode('utf-8').lower() for keyword in KEYWORDS): #Check if listing contains any keywords
                    continue
                if item != l['item']['name'] and "The " + item != l['item']['name'] and "#" not in l['item']['name']: #Check if listing has same name as the item
                    continue
                
                sellPrice = l['currencies']
                ref = round(math.floor(sellPrice.get('metal', 0)),2)
                scrap = (sellPrice.get('metal', 0) - ref) / REF_PER_SCRAP
                scrap += sellPrice.get('keys', 0) * keyPrice
                scrap += ref * SCRAP_PER_REF
                listings[l["steamid"]] = int(scrap)
            return listings
        else:
            return "sleep" #Pause the program / prevent rate limiting
    except KeyError as e:
        print(f"KeyError: {e}")
        return None

    