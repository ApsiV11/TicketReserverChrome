# Simple ticket reserver for KideApp

## Requirements
Python 3 with requests package installed. 
1. https://www.python.org/downloads/
1. `pip3 install requests`

## How to use
1. Run the file in command line or in the way of your choosing.  
```python3 KideApp.py```
1. Follow the instructions (made for Google Chrome).  
    1. Give the event id: for example https://kide.app/events/<ins>50380297-20d7-425c-9497-0b67d6dff50a</ins> <- This part.
    1. The bot reserves the first ticket if no other info is specified.
    1. Price info needs to be given in cents: for example 14€=1400.
    1. Keywords can be given in the format `optional|optional|optional,wanted,wanted,optional|optional`.
1. After filling in the information the bot waits until the tickets are on sale and then buys them.
1. The tickets you wanted should be in your Kide App cart ready for buying/inputing extra info.

## Disclaimer
This script possibly violates the Customer Terms of Kide App.
I'm not responsible for the use of this script.
