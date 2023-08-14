from undetected_chromedriver import Chrome, ChromeOptions
from bpTFsnapshot import request_listings
from bpTFsnapshot import REF_PER_SCRAP, SCRAP_PER_REF
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from steam_totp import generate_twofactor_code_for_time
from colorama import init as colorama_init
from dotenv import load_dotenv
from colorama import Fore, Style
from queue import Queue
from threading import Lock

import subprocess
import threading
import time
import re
import os



class color:
   PURPLE = '\033[95m'
   CYAN = '\033[96m'
   DARKCYAN = '\033[36m'
   BLUE = '\033[94m'
   GREEN = '\033[92m'
   YELLOW = '\033[93m'
   RED = '\033[91m'
   BOLD = '\033[1m'
   UNDERLINE = '\033[4m'
   END = '\033[0m'
load_dotenv()
colorama_init()

def run_javascript():
    process = subprocess.call(['node', "./listingUser.js"])
        
    while True:
        output = process.stdout.readline()
        if output == b'' and process.poll() is not None:
            break
        if output:
            print(f'{output.decode().strip()}')

def check_amt_listings(listings, buyPrice):
    profitableListings = {key: value for key, value in listings.items() if value[0] > int(buyPrice)}
    return profitableListings

def write_to_listings(name,price,profitableListings,keyPrice):
    with open('listings.csv','a') as f:
        #name, price, listings, keyPrice, bought from scrap.tf, listings isBot (true = buy)
        f.write(f"{name},{price},{profitableListings},{keyPrice},{False},{False}\n")

def read_from_buyItem():
    with open('buyItem.csv','r') as f:
        lines = f.readlines()
        for line in lines:
            split_values = re.findall(r'([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)', line)
            name,price,botListings,keyPrice,scrapTF,isBot = split_values[0]
            if isBot.strip() == 'True' and scrapTF.strip() == 'False':
                return [name,price,botListings,keyPrice,scrapTF,isBot]
            else:
                return None

def observe_csv(csv_file_path, on_change_callback, driver):
    print(f"{Fore.CYAN}OB: {Style.RESET_ALL}Watching buyItem.csv for changes...")
    
    class CSVFileHandler(FileSystemEventHandler):
        def __init__(self, csv_file_path, on_change_callback):
            super().__init__()
            self.csv_file_path = csv_file_path
            self.on_change_callback = on_change_callback
            self.change_queue = Queue()
            self.processing_lock = Lock()

        def on_modified(self, event):
            if not event.is_directory and event.src_path == self.csv_file_path:
                self.change_queue.put(event.src_path)

        def process_changes(self):
            while not self.change_queue.empty():
                csv_file_path = self.change_queue.get()
                self.on_change_callback(driver)
                self.change_queue.task_done()

    def observe_csv_file(csv_file_path, on_change_callback):
        event_handler = CSVFileHandler(csv_file_path, on_change_callback)
        observer = Observer()
        observer.schedule(event_handler, path='.', recursive=False)
        observer.start()
        try:
            while True:
                event_handler.process_changes()
        except KeyboardInterrupt:
            observer.stop()
        observer.join()

    observe_csv_file(csv_file_path, on_change_callback)

def remove_from_buyItem(row):
    print(f'{Fore.CYAN}OB: {Style.RESET_ALL}{color.BOLD}{row[0]}{color.END} removed from buyItem.csv!')
    with open('buyItem.csv','r') as f:
        lines = f.readlines()
    with open('buyItem.csv','w', newline='') as f:
        for line in lines:
            split_values = re.findall(r'([^,]+),([^,]+),(.+),([^,]+),([^,]+),([^,]+)', line)
            elems = list(split_values[0])
            if elems != row:
                f.write(line)

def add_to_tradeOffers(row):
    print(f'{Fore.CYAN}OB: {Style.RESET_ALL}{color.BOLD}{row[0]}{color.END} added to TradeOffers.csv!'+'')
    with open('TradeOffers.csv','a') as f:
        f.write(f"{row[0]},{row[1]},{row[2]},{row[3]},{row[4]},{row[5]}".replace("False","True"))
        #Making sure to write scrapTF as true since item has been bought from scrap.tf

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
    #Fix needed to make more efficient and work as intended
    #Only works for hats section, find out a way to fix...
    time.sleep(1)
    driver.get('https://scrap.tf/buy/hats/')
    row = read_from_buyItem()
    if row == None:
        return
    else:
        print(f"{Fore.CYAN}OB: {Style.RESET_ALL}buyItem.csv changed. Processing...")
    
    search = WebDriverWait(driver, 15).until(EC.visibility_of_element_located((By.XPATH, '//*[@id="reverse-header"]/div[1]/div[1]/div[1]/div/input')))
    checkout = WebDriverWait(driver, 15).until(EC.visibility_of_element_located((By.XPATH, '//*[@id="trade-btn"]/i')))
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
                        remove_from_buyItem(row)
                        add_to_tradeOffers(row)
                        try:
                            #Wait for trade offer to appear!
                            completed = '//*[@id="generic-modal"]/div[2]/div/div'
                            tradeOffer = '//*[@id="pid-hats"]/div[2]/div/div[2]/div[2]/button[2]'
                            print(f"{Fore.CYAN}OB: {Style.RESET_ALL}{color.BOLD}{name}{color.END} bought from scrapTF\n")
                            WebDriverWait(driver,200).until(EC.visibility_of_element_located((By.XPATH, tradeOffer)))
                            WebDriverWait(driver,300).until(EC.visibility_of_element_located((By.XPATH, completed))) #completed scrapTF trade, can move on to next item.
                            print(f"{Fore.CYAN}------{Style.RESET_ALL}scrapTF: {color.BOLD}{name}{color.END} passed!{Fore.CYAN}------{Style.RESET_ALL}\n")
                        except TimeoutException:
                            try:
                                #Try canceling the scrapTF offer
                                cancel = '//*[@id="pid-hats"]/div[2]/div/div[1]/div[3]/button'
                                cancelBtn = WebDriverWait(driver,1).until(EC.visibility_of_element_located((By.XPATH, cancel)))
                                cancelBtn.click()
                                print(f"{Fore.CYAN}OB: {Style.RESET_ALL}{color.BOLD}{name}{color.END} canceled for {price} scrap\n")
                            except TimeoutException:
                                print("Cancel button not found (Trade offer may have been sent)")
                                pass
                        return

        print(f"{Fore.LIGHTRED_EX}(!) FAILED TO FIND ITEM{Style.RESET_ALL} - {name} for {price}")
        remove_from_buyItem(row)
        return
    except:
        #An item is already in checkout or item unavailable
        print(f"{Fore.LIGHTRED_EX}(!) FAILED TO CHECKOUT{Style.RESET_ALL} - {name} for {price}\n")
        return

def compare(item_data, keyPrice):
    failed = profitable = 0
    for name, price in item_data.items():
        start = time.time()
        listings = request_listings(name, keyPrice)
        

        #Check for errors
        if listings == "sleep": #Sleep to avoid rate limit
            #print(f"{Fore.YELLOW}(!) {Fore.CYAN}SLEEP{Style.RESET_ALL} - {name}\n")
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
        steamID = max(listings, key=lambda x: listings[x][0])
        sellPrice = listings[steamID][0]
        if sellPrice - int(price) >= 1:
            if "|" in name: #Remove | seperator if unusual
                name = f'{Fore.MAGENTA}{name.split("|")[0]}{Style.RESET_ALL} {name.split("|")[1]}'
            profitableListings = check_amt_listings(listings, price) 
            print(f"\n\033[1m{name}:\033[0m\n{Fore.RED}Buy: {int(price)}, {Fore.GREEN}Sell: {int(sellPrice)}, {Fore.YELLOW}Profit: {int(sellPrice - int(price))}{Style.RESET_ALL}\n")
            write_to_listings(name,price,profitableListings,keyPrice)
            profitable += 1
        stop = time.time()
        time.sleep(1-(stop-start) if 1-(stop-start) > 0 else 0)
    return profitable, failed

def scrapTF():
    url = 'https://scrap.tf/buy/hats'

    driver = Chrome()
    driver.get(url)

    #Start the buy item thread
    observe = threading.Thread(target=observe_csv, args=('/Users/maximilian/Documents/GitHub/profitTraderTF2/buyItem.csv',buy_item,driver,))
    observe.start()

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
    EC.visibility_of_element_located((By.CSS_SELECTOR, 'div.segmentedinputs_SegmentedCharacterInput_3PDBF')))
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
        c+=1

        #Get key price on scrap.tf
        driver.get('https://scrap.tf/keys')
        element = WebDriverWait(driver, 30).until(EC.presence_of_element_located((By.XPATH, '//*[@id="pid-keys"]/div[3]/div/div/div[2]/h3[2]/span')))
        if len(element.text.split(" ")[0]) > 2:
            keyPrice = float(element.text.split(" ")[0][0:2])*SCRAP_PER_REF + float(element.text.split(" ")[0][2:])/REF_PER_SCRAP
        else:
            keyPrice = float(element.text.split(" ")[0])*SCRAP_PER_REF

        # Hats Scrap.tf
        hats_data = {}
        driver.get('https://scrap.tf/buy/hats')
        elements = WebDriverWait(driver, 20).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        for i in range(0, len(elements)-1):
            items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            for item in items:
                if 'quality1' in item.get_attribute('class') and 'quality11' not in item.get_attribute('class'):
                    #Problem with searching for genuine items in scrap.tf!
                    continue
                    name = "Genuine " + clean_name(item.get_attribute('data-title'))
                    print(name)
                else:
                    name = clean_name(item.get_attribute('data-title'))
                price = item.get_attribute('data-item-value')
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
        #items_data = {}
        #driver.get('https://scrap.tf/buy/items')
        #elements = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.CLASS_NAME, 'banking-category')))
        #for i in range(0, len(elements)):
            #items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-{i}"]/div/div')))
            #for item in items:
                #price = item.get_attribute('data-item-value')
                #name = clean_name(item.get_attribute('data-title'))
                #if "Uncraftable" in item.get_attribute('data-content'):
                    #name = "Non-Craftable " + name
                #items_data = cheapest_price(items_data,name,price)
        #print(f"\n\n{Fore.YELLOW}§ Items §{Style.RESET_ALL}")
        #profitableItems, failedItems = compare(items_data, keyPrice)
        #print(f"{Fore.YELLOW}Items Section complete!{Style.RESET_ALL}\n- {len(items_data)} LISTINGS\n- {profitableItems} PROFITABLE\n- {failedItems} FAILED\n\n")


        # Strange Scrap.tf
        #strange_data = {}
        #driver.get('https://scrap.tf/buy/stranges')
        #items = WebDriverWait(driver, 10).until(EC.presence_of_all_elements_located((By.XPATH, f'//*[@id="category-0"]/div/div')))
        #for item in items:
            #price = item.get_attribute('data-item-value')
            #name = clean_name(item.get_attribute('data-title'))
            #strange_data = cheapest_price(strange_data,name,price)
        #print(f"\n\n{Fore.LIGHTYELLOW_EX}§ Strange §{Style.RESET_ALL}")
        #profitableStranges, failedStranges = compare(strange_data, keyPrice)
        #print(f"{Fore.YELLOW}Strange Section complete!{Style.RESET_ALL}\n- {len(strange_data)} LISTINGS\n- {profitableStranges} PROFITABLE\n- {failedStranges} FAILED\n\n")

        #failed = failedHats + failedUnusuals + failedItems + failedStranges
        #profitable = profitableHats + profitableUnusuals + profitableItems + profitableStranges
        #print(f"\n\n{Fore.LIGHTYELLOW_EX}Cycle {c} Complete!{Style.RESET_ALL}\n- {len(hats_data) + len(items_data) + len(strange_data)} LISTINGS\n- {profitable} PROFITABLE\n- {failed} FAILED\n\n") #+ len(unusuals_data)
        print(f"\n\n{Fore.LIGHTYELLOW_EX}Cycle {c} Complete!{Style.RESET_ALL}")

#Run javascript program
javascript_thread = threading.Thread(target=run_javascript)
javascript_thread.start()
time.sleep(30)
scrapTF() 



