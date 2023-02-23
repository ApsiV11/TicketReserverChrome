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
    const regexedString = tabs[0].url.match(/https:\/\/kide\.app\/events\/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/)

    if(!regexedString) {
        document.write("<h2>Please navigate to the event page an reload this script!</h2>")
    }

    const id = regexedString[1]
    document.getElementById("reserveButton").addEventListener("click", async (e) => {
        //Get value of amount field
        const amountField = document.getElementById("amount").value
        const amount = amountField ? amountField : 1
        //Get values of optional, user-given fields
        const type = document.getElementById("type").value
        const price = document.getElementById("price").value
        const keywords = document.getElementById("keywords").value

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
        document.write("<h2>Waiting for the sales to start</h2>")
        await sleep(startTime-now >= 0 ? startTime-now : 0)
        document.write("<h2>Begin script</h2>")

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

        //Get maximum amount that can be reserved
        let maxTotalReservationsPerCheckout = product['maxTotalReservationsPerCheckout']

        let toCreates = []
        let variant = 0

        //If there is no maximum amount, reserve every type
        if(!maxTotalReservationsPerCheckout) {
            document.write("<p>Reservations not limited. Reserving the amount specified of every type.</p>")
            for(const v of variants) {
                let availability = v['availability']
                let productVariantMaximumReservableQuantity = v['productVariantMaximumReservableQuantity']
                if(availability>0) {
                    toCreates.push({"inventoryId": v['inventoryId'], "quantity": Math.min(amount, availability, productVariantMaximumReservableQuantity)})
                }
            }
        }

        else {

            //If type is selected, reserve it
            if(type.length>0) {
                variant = int(variantSelect)
            }

            //If no type is selected but a price is specified, search for correct variant
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

            //Else reserve with respect to keywords
            else if(keywords.length>0) {
                const keys = keywords.toLowerCase().trim().split(",")
                let i = 0
                while(i<variants.length) {
                    let desc = variants[i]['description'].toLowerCase().trim()
                    let name = variants[i]['name'].toLowerCase().trim()
                    let descpname = desc+name
                    let found = keys.every((keys) => keys.split("|").some((key) => descpname.includes(key.trim())))
                    if(found) {
                        variant = i
                        break
                    }
                    i=i+1
                }
            }

            document.write("<p>Reservations limited. Buying variant at index " + variant+".</p>")
            let v = variants[variant]
            let availability = v['availability']
            toCreates.push({"inventoryId": v['inventoryId'], "quantity": Math.min(amount, availability, maxTotalReservationsPerCheckout)})
        }

        //Reservation
        let response2 = await makeReservation(toCreates, auth)
        document.write("<h3>Status: "+response2.status+"</h3>")
        if(response2.status==200) {
            chrome.tabs.reload()
        }

        let variantIndex = 0
        //If the reservation fails try every variant one at a time
        while(maxTotalReservationsPerCheckout && response2.status!=200) {
            toCreates=[]
            document.write("<h3>Error, trying again</h3>")
            if(variantIndex == variant) {
                variantIndex = variantIndex+1
            }
            let v=variants[variantIndex]
            console.log(variantIndex)
            let availability = v['availability']
            toCreates.push({"inventoryId": v['inventoryId'], "quantity":Math.min(amount, availability, maxTotalReservationsPerCheckout)})

            //Reservation
            response2 = await makeReservation(toCreates, auth)
            document.write("<h3>Status: "+response2.status+"</h3>")

            if(response2.status==200) {
                chrome.tabs.reload()
            }

            variantIndex = variantIndex+1
        }

        //If the availibity info is wrong, we need to try again without the variant that failed
        while(!maxTotalReservationsPerCheckout && response2.status!=200) {
            document.write("<h3>Error, trying again</h3>")
            let jsonData = await response2.json()
            let errorInventoryId = jsonData['error']['entity']['inventoryId']

            let newVariants = []

            for(const v of toCreates) {
                if(v['inventoryId']!=errorInventoryId) {
                    newVariants.push(v)
                }
            }

            toCreates = newVariants

            //Reservation
            response2 = await makeReservation(toCreates, auth)
            document.write("<h3>Status: "+response2.status+"</h3>")

            if(response2.status==200) {
                chrome.tabs.reload()
            }
        }
        //document.write("<h3>Response JSON</h3>")
        //document.write(`<p>${JSON.stringify(await response2.json())}</p>`)

        if(response2.status==200) {
            document.write("<h2>Reservation successful!</h2>")
        }
        else {
            document.write("<h2>Error!</h2>")
        }
    })
});