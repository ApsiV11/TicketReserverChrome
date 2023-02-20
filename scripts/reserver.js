function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeReservation(toCreates, auth) {
    let body = {"toCreate":toCreates,"toCancel":[]}

    const url = "https://api.kide.app/api/reservations"
    const options = {
        method: "POST",
        headers: {
            "authorization": "Bearer "+auth,
            'origin': 'https://kide.app',
            'referer': 'https://kide.app/',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }

    return fetch(url, options)
}

chrome.tabs.query({currentWindow: true, active: true}, async (tabs) => {
    const result = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => {return localStorage['authorization.token']} })
    
    const auth = result[0].result.substring(1, result[0].result.length-1)
    const id = tabs[0].url.match(/https:\/\/kide\.app\/events\/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/)[1]
    document.getElementById("reserveButton").addEventListener("click", async (e) => {
        //Get value of amount field
        const amountField = document.getElementById("amount").value
        const amount = amountField ? amountField : 1
        //Get values of optional, user-given fields
        const type = document.getElementById("type").value
        const price = document.getElementById("price").value
        const keywords = document.getElementById("keywords").value.toLowerCase().trim().split(",")

        //Fetch the start time of sales
        const url = "https://api.kide.app/api/products/" + id
        const options = {
            method: "GET",
            headers: {
                "authorization": "Bearer "+auth,
                'origin': 'https://kide.app',
                'referer': 'https://kide.app/'
            }
        }
        const startTimeOfSales = (await (await fetch(url, options)).json())['model']['product']['dateSalesFrom']
        const startTime = new Date(startTimeOfSales).getTime()
        const now = new Date().getTime()
        await sleep(startTime-now >= 0 ? startTime-now : 0)

        let variants, product

        //Make sure that the sales have actually started
        while(true) {
            const inventoryData = (await (await fetch(url, options)).json())
            variants = inventoryData['model']['variants']
            product = inventoryData['model']['product']
            let salesOngoing = product['salesOngoing']
            let salesPaused = product['salesPaused']
            let salesStarted = product['salesStarted']
            if(salesStarted && salesOngoing && !salesPaused) {
                break
            }
        }

        let maxTotalReservationsPerCheckout = product['maxTotalReservationsPerCheckout']

        let toCreates = []
        if(!maxTotalReservationsPerCheckout) {
            for(const v of variants) {
                let availability = v['availability']
                let productVariantMaximumReservableQuantity = v['productVariantMaximumReservableQuantity']
                if(availability>0) {
                    toCreates.push({"inventoryId": v['inventoryId'], "quantity": Math.min(amount, availability, productVariantMaximumReservableQuantity)})
                }
            }
        }

        else {
            let variant = 0

            if(type.length>0) {
                variant = int(variantSelect)
            }

            else if(price>0) {
                let i = 0
                while(i<variants.length) {
                    let pricePerItem = variants[i]['pricePerItem']
                    if(pricePerItem==wantedPrice) {
                        variant = i
                        break
                    }
                    i=i+1
                }
            }

            else if(avainsanat.length>0) {
                let i = 0
                while(i<variants.length) {
                    let desc = variants[i]['description'].lower().strip()
                    let name = variants[i]['name'].lower().strip()
                    let descpname = desc+name
                    let found = keywords.every((keys) => keys.split("|").some((key) => descpname.contains(key.trim())))
                    if(found) {
                        variant = i
                        break
                    }
                    i=i+1
                }
            }

            document.write("Reservations limited. Buying variant at index" + variant)
            let v = variants[variant]
            let availability = v['availability']
            toCreates.push({"inventoryId": v['inventoryId'], "quantity": Math.min(amount, availability, maxTotalReservationsPerCheckout)})
        }

        let response2 = await makeReservation(toCreates, auth)
        document.write("Status: "+response2.status)
        if(response2.status==200) {
            chrome.tabs.reload()
        }

        //TODO: Implement code starting from line 123 in Python file.
    })
});