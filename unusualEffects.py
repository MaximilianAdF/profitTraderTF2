from bs4 import BeautifulSoup
import requests
import re


particles = {}
url = "https://backpack.tf/developer/particles"
response = requests.get(url)
html = response.content

soup = BeautifulSoup(html, 'html.parser')
table = soup.find('table')
rows = table.find_all('tr')

for row in rows[1:]:
    name_element = row.select_one('td:nth-child(2)').get_text(strip=True)
    number = row.select_one('.text-muted').get_text(strip=True)[1:]
    name = re.sub(r'^#\d+', '', name_element).strip()
    particles[name] = number
    