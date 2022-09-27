import requests
from datetime import datetime
import time

print("Ensimmäiseksi anna kide.app-osoitteesta events/ -jälkeinen osuus.")
url = input("ID: ")
eventUrl = "https://api.kide.app/api/products/"+url

amount = int(input("Kuinka monta lippua haluat: ") or "1") #Kuinka monta lippua halutaan

print("Seuraavaksi anna lipputyyppi, mikä tarkoittaa lipun järjestysnumeroa ylhäältä alas välillä 0-n.")
print("Vaihtoehtoisesti voit antaa lipun hinnan sentteinä (esim 10€=1000)")
print("Vaihtoehtoisesti voit antaa avainsanoja haluamallesi lipputyypille pilkulla erotettuna ja vaihtoehtoisia valintoja |-merkillä erotettuna.")
print("Lipputyypin numerovalintaa priorisoidaan.")
variantSelect = input("Lipputyyppi (0-n): ") # Kuinka mones variantti halutaan. Usein ei voi tietää, mikä halutaan etukäteen. Täytynee arvata :(
wantedPrice = int(input("Lipun hinta sentteinä: ") or "0")
avainsanatS = input("Avainsanat: ")
avainsanat = avainsanatS.lower().strip().split(",")

#Tähän oma auth-avain (Chrome -> Ctrl+Shift+I -> Application -> Local Storage -> https://kide.app -> kopioi authorization.token-arvo)

print("Seuraavaksi anna auth-token.")
print("Tokenin löytää seuraavilla ohjeilla.")
print("Chrome -> Ctrl+Shift+I -> Application -> Local Storage -> https://kide.app -> kopioi authorization.token-arvo.")
print("Anna token ilman heittomerkkejä")
bearer = input("Auth-token: ")

print("Seuraavaksi skripti odottaa, kunnes liput tulevat myyntiin.")

#Haetaan myynnin aloitusaika
response = requests.get(
                eventUrl,
                headers={'authorization': "Bearer "+bearer, 'origin': 'https://kide.app', 'referer': 'https://kide.app/'}
                )

inventoryData = response.json()
saleStart = datetime.fromisoformat(inventoryData['model']['product']['dateSalesFrom'])

#Odota kunnes liput tulevat myyntiin
while(datetime.now().astimezone()<saleStart):
    time.sleep(0.2)
    print("Odottaa...")

#Odotetaan kunnes liput tulevat oikeasti saataville varmuuden vuoksi
while True:
    response = requests.get(
                eventUrl,
                headers={'authorization': "Bearer "+bearer, 'origin': 'https://kide.app', 'referer': 'https://kide.app/'}
                )

    inventoryData = response.json()
    variants = inventoryData['model']['variants']
    product = inventoryData['model']['product']
    salesOngoing = product['salesOngoing']
    salesPaused = product['salesPaused']
    salesStarted = product['salesStarted']
    if(salesStarted and salesOngoing and not salesPaused):
        break

maxTotalReservationsPerCheckout = product['maxTotalReservationsPerCheckout'] #Tarkistetaan, onko varauksille rajoitetta

#Apufunktio POST-kutsujen tekemiseen varaamiseksi
def makeRequest(toCreates):
    body = {"toCreate":toCreates,"toCancel":[]}

    apiUrl = "https://api.kide.app/api/reservations"

    response2 = requests.post(
                apiUrl,
                json=body,
                headers={'authorization': "Bearer "+bearer, 'origin': 'https://kide.app', 'referer': 'https://kide.app/'}
                )
    return response2

toCreates = []
if(maxTotalReservationsPerCheckout is None):
    for v in variants:
        availability = v['availability']
        productVariantMaximumReservableQuantity = v['productVariantMaximumReservableQuantity']
        if(availability>0):
            toCreates.append({"inventoryId": v['inventoryId'], "quantity":min(amount, availability, productVariantMaximumReservableQuantity)})

#Jos varaukset on rajoitettu, otetaan vain sitä, mikä määritettiin aluksi
else:
    variant = 0

    #Jos indeksi annettu, valitaan se
    if(len(variantSelect)>0):
        variant = int(variantSelect)

    elif(wantedPrice>0):
        i = 0
        while(i<len(variants)):
            pricePerItem = variants[i]['pricePerItem']
            if(pricePerItem==wantedPrice):
                variant = i
                break
            i=i+1

    #Tarkistetaan löytyykö annettuja avainsanoja lipputyyppien kuvauksesta
    elif(len(avainsanat)>0):
        i = 0
        while(i<len(variants)):
            desc = variants[i]['description'].lower().strip()
            name = variants[i]['name'].lower().strip()
            descpname = desc+name
            found = all(any(key.strip() in descpname for key in keys.split("|")) for keys in avainsanat)
            if(found):
                variant = i
                break
            i=i+1

    print("Reservations limited. Buying variant at index",variant)
    v = variants[variant] #Otetaan lippu, mikä halutaan
    availability = v['availability']
    toCreates.append({"inventoryId": v['inventoryId'], "quantity":min(amount, availability, maxTotalReservationsPerCheckout)})

#Varataan liput
response2 = makeRequest(toCreates)

print("Status: " + str(response2.status_code))

#Jos kokonaisvarausmäärä rajoitettu, varauksen epäonnistuessa tulee kokeilla jokaista lipputyyppiä erikseen
variantIndex = 0
while(maxTotalReservationsPerCheckout is not None and response2.status_code!=200):
    toCreates=[]
    print("Virhe, yritetään uudestaan")
    if(variantIndex == variant): variantIndex = variantIndex+1
    v=variants[variantIndex]
    availability = v['availability']
    toCreates.append({"inventoryId": v['inventoryId'], "quantity":min(amount, availability, maxTotalReservationsPerCheckout)})

    #Varataan liput
    response2 = makeRequest(toCreates)

    print("Status: " + str(response2.status_code))

    variantIndex = variantIndex+1

#Jos ensimmäisestä kutsusta saatu saatavuusdata on väärää tai tapahtuu virhe, kutsu voi epäonnistua osittain, jolloin kokeillaan uudelleen ilman tätä tuotetta.
#Tämä voi toistua useasti
while(maxTotalReservationsPerCheckout is None and response2.status_code!=200):
    print("Virhe, yritetään uudestaan")
    jsonData = response2.json()
    errorInventoryId = jsonData['error']['entity']['inventoryId']

    newVariants = []

    for variant in toCreates:
        if(variant['inventoryId']!=errorInventoryId):
            newVariants.append(variant)

    toCreates = newVariants

    #Varataan liput
    response2 = makeRequest(toCreates)

    print("Status: " + str(response2.status_code))

#Lopuksi printataan onnistuneen kutsun JSON
print("Vastaus JSON:")
print(response2.json())
