from selenium import webdriver
from bpTFsnapshot import request_listings
from bpTFsnapshot import REF_PER_SCRAP, SCRAP_PER_REF
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from steam_totp import generate_twofactor_code_for_time
from colorama import init as colorama_init
from dotenv import load_dotenv
from colorama import Fore
from colorama import Style
import subprocess
import threading
import time
import re
import os


load_dotenv()
colorama_init()
def run_javascript():
    process = subprocess.call(['node', r"C:\Users\Maximilian\Documents\GitHub\scrapTFtrader\listingUser.js"])
        # Read and print the output from the JavaScript program
    while True:
        output = process.stdout.readline()
        if output == b'' and process.poll() is not None:
            break
        if output:
            print(f'{output.decode().strip()}')

def check_amt_listings(listings, buyPrice):
    profitableListings = {key: value for key, value in listings.items() if value > int(buyPrice)}
    return profitableListings

def write_to_csv(name,price,profitableListings,keyPrice):
    with open('listings.csv','a') as f:
        #name, price, listings, keyPrice, bought from scrap.tf, listings isBot (true = buy)
        f.write(f"{name},{price},{profitableListings},{keyPrice},{False},{False}\n")

def read_from_csv():
    with open('listings.csv','r') as f:
        lines = f.readlines()
        for line in lines:
            name,price,listings,keyPrice,scrapTF,isBot = line.split(",")
            if isBot == False or scrapTF == True:
                continue
            elif isBot == True and scrapTF == False:
                return name,price,listings,keyPrice,scrapTF,isBot
        return None,None,None,None,None,None

def update_csv(row):
    with open('TradeOffers.csv','r') as f:
        lines = f.readlines()
    with open('TradeOffers.csv','w') as f:
        for line in lines:
            if line == row:
                f.write(line[0], line[1], line[2], line[3], True, line[5])
                break

def cheapest_price(item_data,name,price):
    if name in item_data:
        if price < item_data[name]:
            item_data[name] = price
    else:
        item_data[name] = price
    return item_data

def clean_name(name):
    return re.sub(r'<.*?>', '', name)

def buy_item(driver):
    #Watcher for csv file needed
    #Need to fix logic so it doesn't crash when you have clicked items that cant be bought with others.
    row = read_from_csv()
    if row == (None,None,None,None,None,None):
        return False
    
    search = driver.find_element(By.XPATH, '//*[@id="reverse-header"]/div[1]/div[1]/div[1]/div/input')
    checkout = driver.find_element(By.XPATH, '//*[@id="trade-btn"]/i')
    name,price = row[0:2]
    search.clear()
    search.send_keys(name)

    try:
        elements = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        for i in range(0, len(elements)):
            items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            for item in items:
                if name == clean_name(item.get_attribute('data-title')):
                    if price >= item.get_attribute('data-item-value'):
                        item.click()
                        checkout.click()
                        search.clear()
                        update_csv(row)
                        return
        search.clear()
        return
    except:
        search.clear()
        return

def compare(item_data, keyPrice):
    failed = profitable = 0
    for name, price in item_data.items():
        listings = request_listings(name, keyPrice)
        time.sleep(1)

        #Check for errors
        if listings == "sleep": #Sleep to avoid rate limit
            print(f"{Fore.YELLOW}(!) {Fore.CYAN}SLEEP{Style.RESET_ALL} - {name}\n")
            time.sleep(5)
            listings = request_listings(name, keyPrice)
        if listings == "name": #Add/Remove "The " from the name
            print(f"{Fore.YELLOW}(!) {Fore.CYAN}NAME{Style.RESET_ALL} - {name}\n")
            if "The " in name: 
                listings = request_listings(name.replace("The ", ""), keyPrice)
            else:
                if "Strange" in name or "Vintage" in name or "Genuine" in name:
                    prefix = name.split(" ")[0]
                    listings = request_listings(prefix + " The " + " ".join(name.split(" ")[1:]), keyPrice)
                else:
                    listings = request_listings("The " + name, keyPrice)
        if any(i == listings for i in [None, "sleep", "name"]): #Catch double errors
            failed += 1
            continue
                
        #Check if profitable
        steamID = max(listings, key=lambda x: listings[x])
        sellPrice = listings[steamID]
        if sellPrice - int(price) >= 1:
            if "|" in name: #Remove | seperator if unusual
                name = f'{Fore.MAGENTA}{name.split("|")[0]}{Style.RESET_ALL} {name.split("|")[1]}'
            profitableListings = check_amt_listings(listings, price) 
            print(f"\033[1m{name}:\033[0m\n{Fore.RED}Buy: {int(price)}, {Fore.GREEN}Sell: {int(sellPrice)}, {Fore.YELLOW}Profit: {int(sellPrice - int(price))}{Style.RESET_ALL}\n")
            write_to_csv(name,price,profitableListings,keyPrice)
            profitable += 1

    return profitable, failed

def scrapTF():
    url = 'https://scrap.tf/buy/hats'

    driver = webdriver.Chrome()
    driver.get(url)

    #Start the buy item thread
    #buyitem_thread = threading.Thread(target=buy_item, args=(driver,))
    #buyitem_thread.start()

    # Wait for the username input field to be visible
    username_input = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'input.newlogindialog_TextInput_2eKVn'))
    )
    username_input.send_keys(os.getenv("STEAM_USERNAME"))

    # Wait for the password input field to be visible
    password_input = WebDriverWait(driver, 10).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, 'input.newlogindialog_TextInput_2eKVn[type="password"]'))
    )
    password_input.send_keys(os.getenv("STEAM_PASSWORD"))

    # Find and click the submit button
    submit_button = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, 'button.newlogindialog_SubmitButton_2QgFE'))
    )
    submit_button.click()

    #Steam Guard input
    steam_guard_code = generate_twofactor_code_for_time(shared_secret=os.getenv("STEAM_SHARED_SECRET"))
    steam_guard_input_container = WebDriverWait(driver, 10).until(
    EC.visibility_of_element_located((By.CSS_SELECTOR, 'div.segmentedinputs_SegmentedCharacterInput_3PDBF'))
    )
    steam_guard_inputs = steam_guard_input_container.find_elements(By.TAG_NAME, 'input')
    for i in range(len(steam_guard_code)):
        steam_guard_inputs[i].send_keys(steam_guard_code[i])

    # Wait for the sign in button to be visible and click it
    sign_in_button = WebDriverWait(driver, 10).until(
        EC.element_to_be_clickable((By.CSS_SELECTOR, 'input.btn_green_white_innerfade[value="Sign In"]'))
    )
    sign_in_button.click()

    c=0
    while True:
        #Clear items from csv that have x,x,x,x,True,True
        c+=1

        #Get key price on scrap.tf
        driver.get('https://scrap.tf/keys')
        element = WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.XPATH, '//*[@id="pid-keys"]/div[3]/div/div/div[2]/h3[2]/span')))
        keyPrice = int(element.text[0:2])*SCRAP_PER_REF + float("0."+element.text[3:5])/REF_PER_SCRAP


        # Hats Scrap.tf
        hats_data = {}
        driver.get('https://scrap.tf/buy/hats')
        elements = WebDriverWait(driver, 20).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        for i in range(0, len(elements)-1):
            items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            for item in items:
                price = item.get_attribute('data-item-value')
                name = clean_name(item.get_attribute('data-title'))
                hats_data = cheapest_price(hats_data,name,price)
        print(f"\n\n{Fore.CYAN}§ Hats §{Style.RESET_ALL}")
        profitableHats, failedHats = compare(hats_data, keyPrice)
        print(f"{Fore.CYAN}Hats Section complete!{Style.RESET_ALL}\n- {len(hats_data)} LISTINGS\n- {profitableHats} PROFITABLE\n- {failedHats} FAILED\n\n")


        # Unusual Scrap.tf
        #unusuals_data = {}
        #driver.get("https://scrap.tf/unusuals/89")
        #elements = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        #for i in range(0,len(elements)):
            #items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            #for item in items:
                #price = item.get_attribute('data-item-value') #Price in scrap metal
                #name = clean_name(item.get_attribute('data-title')) #Name of cosmetic
                #br = item.get_attribute('data-content').split('<br/>')
                #for i in range(len(br)):
                    #if 'Effect: ' in br[i]:
                        #effect = br[i][8:]
                        #name = effect + "|" + name
                        #break
                #unusuals_data = cheapest_price(unusuals_data,name,price)
        #print(f"\n\n{Fore.MAGENTA}§ Unusuals §{Style.RESET_ALL}")
        #profitableUnusuals, failedUnusuals = compare(unusuals_data, keyPrice)
        #print(f"{Fore.MAGENTA}Unusuals Section complete!{Style.RESET_ALL}\n- {len(unusuals_data)} LISTINGS\n- {profitableUnusuals} PROFITABLE\n- {failedUnusuals} FAILED\n\n")


        # Items Scrap.tf
        items_data = {}
        driver.get('https://scrap.tf/buy/items')
        elements = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        for i in range(0, len(elements)):
            items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            for item in items:
                price = item.get_attribute('data-item-value')
                name = clean_name(item.get_attribute('data-title'))
                if "Uncraftable" in item.get_attribute('data-content'):
                    name = "Non-Craftable " + name
                items_data = cheapest_price(items_data,name,price)
        print(f"\n\n{Fore.YELLOW}§ Items §{Style.RESET_ALL}")
        profitableItems, failedItems = compare(items_data, keyPrice)
        print(f"{Fore.YELLOW}Items Section complete!{Style.RESET_ALL}\n- {len(items_data)} LISTINGS\n- {profitableItems} PROFITABLE\n- {failedItems} FAILED\n\n")


        # Strange Scrap.tf
        strange_data = {}
        driver.get('https://scrap.tf/buy/stranges')
        items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-0"]/div/div')))
        for item in items:
            price = item.get_attribute('data-item-value')
            name = clean_name(item.get_attribute('data-title'))
            strange_data = cheapest_price(strange_data,name,price)
        print(f"\n\n{Fore.LIGHTYELLOW_EX}§ Strange §{Style.RESET_ALL}")
        profitableStranges, failedStranges = compare(strange_data, keyPrice)
        print(f"{Fore.YELLOW}Strange Section complete!{Style.RESET_ALL}\n- {len(strange_data)} LISTINGS\n- {profitableStranges} PROFITABLE\n- {failedStranges} FAILED\n\n")

        failedUnusuals = profitableUnusuals = 0
        failed = failedHats + failedUnusuals + failedItems + failedStranges
        profitable = profitableHats + profitableUnusuals + profitableItems + profitableStranges
        print(f"\n\n{Fore.LIGHTYELLOW_EX}Cycle {c} Complete!{Style.RESET_ALL}\n- {len(hats_data) + len(items_data) + len(strange_data)} LISTINGS\n- {profitable} PROFITABLE\n- {failed} FAILED\n\n") #+ len(unusuals_data)


#Run javascript program
javascript_thread = threading.Thread(target=run_javascript)
javascript_thread.start()
time.sleep(45)
scrapTF() 



