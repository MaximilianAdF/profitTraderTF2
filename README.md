# Automated TF2 Trading Bot

## Overview

Welcome to the Automated TF2 Trading Bot repository, a sophisticated solution designed for Team Fortress 2 (TF2) enthusiasts. This fully automated bot leverages the Steam API to seamlessly manage game inventories, construct/accept trade offers, and optimize item trading for maximum profit. Developed in Python and JavaScript for efficient API handling, this bot streamlines the trading process by continuously comparing item prices on scrap.tf with those on backpack.tf. When an opportunity for profit arises, the bot autonomously executes the entire transaction from initiation to completion.

## Features

- **Automated Trading**: The bot automates the trading process by utilizing the Steam API to request and manage game inventories, construct trade offers, and handle the intricacies of the TF2 trading ecosystem.

- **Price Comparison**: Constantly monitoring prices on scrap.tf and backpack.tf, the bot intelligently identifies profitable opportunities, ensuring that trades are executed at optimal market values.

- **End-to-End Handling**: From identifying profitable trades to executing them seamlessly, the bot handles the entire trading process, allowing users to focus on strategic decision-making rather than manual transactions.

- **Efficient API Handling**: Developed using Python and JavaScript, the bot is optimized for efficient API handling, ensuring swift and reliable communication with the Steam API for real-time data retrieval and trade execution.

## How It Works

1. **Price Comparison**: The bot continuously fetches and compares item prices on scrap.tf and backpack.tf, identifying potential profit margins.

2. **Trade Initiation**: When a profitable opportunity is detected, the bot constructs a trade offer using the Steam API, initiating the trading process.

3. **Real-time Monitoring**: Throughout the trade, the bot actively monitors the status of the transaction, ensuring a smooth and error-free execution.

4. **Transaction Completion**: Once the trade is successfully completed, the bot concludes the process, providing users with a seamless and efficient trading experience.

## Technologies Used

- **Python**: The primary language for bot logic and trade automation.
  
- **JavaScript**: Utilized for effective handling of the Steam API and real-time data retrieval.

## Usage

A usage guide has not yet been enstated, for any questions regarding setup contact @MaximilianAdF

## Contribution Guidelines

We welcome contributions from the community! If you have ideas for improvements, feature suggestions, or bug fixes, please feel free to contribute.

## Disclaimer

This trading bot is designed for educational and informational purposes. It is crucial to adhere to Steam's terms of service and trading policies while utilizing this bot. The developers are not responsible for any misuse or violations of Steam's terms.

Explore the world of TF2 trading with confidence using the Automated TF2 Trading Bot! Optimize your trades, maximize your profits, and enjoy a streamlined trading experience.

## Setup
>[!IMPORTANT]
> - Create and complete the two following files<br>
> - Place them in the main directory

`config.json`
```json
{
  "STEAM_USERNAME": "YOUR USERNAME",
  "STEAM_PASSWORD": "YOUR PASSWORD",
  "STEAM_SHARED_SECRET": "YOUR SHARED SECRET",
  "STEAM_API_KEY": "YOUR API KEY"
}
```

`.env`
```env
STEAM_USERNAME='YOUR USERNAME'
STEAM_PASSWORD='YOUR PASSWORD'
STEAM_API_KEY='YOUR API KEY'

BPTF_API_KEY='YOUR BACKPACK.TF API KEY'
BPTF_TOKEN='YOUR BACKPACK.TF TOKEN'
```
