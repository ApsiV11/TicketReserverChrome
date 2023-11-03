function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRequestId(inventoryId) {
    const hash = "2ae00a815b01445183d6e36b17b63a93"
	const base64 =  btoa(
		[...inventoryId.replace(/-/g, '')]
			.map((char, i) =>
				String.fromCharCode(char.charCodeAt(0) ^ hash.charCodeAt(i))
			)
			.join('')
	)
    return base64.substring(0, 8);
}

async function makeReservation(toCreates, auth) {
    const url = "https://api.kide.app/api/reservations"
    const successes = await Promise.allSettled(toCreates.map((toCreate) => {
        let body = {"toCreate":[toCreate],"toCancel":[], expectCart: false, includeDeliveryMethods: false}
        const options = {
            method: "POST",
            headers: {
                "authorization": "Bearer "+auth,
                'origin': 'https://kide.app',
                'referer': 'https://kide.app/',
                'Content-Type': 'application/json;charset=UTF-8',
                'X-Requested-Token': getRequestId(toCreate['inventoryId'])
            },
            body: JSON.stringify(body)
        }
        return fetch(url, options).then((res) => res.status==200 ? toCreate['inventoryId'] : null)
    }))

    return successes.filter((s) => s.value!==null)
}

const cont = document.getElementById("container")

function addMessage(text, type) {
    if(type==0) {
        const h2 = document.createElement("h2")
        h2.innerText = text
        cont.appendChild(h2)
    }
    else if(type==1) {
        const h3 = document.createElement("h3")
        h3.innerText = text
        cont.appendChild(h3)
    }
    else {
        const p = document.createElement("p")
        p.innerText = text
        cont.appendChild(p)
    }
}

chrome.tabs.query({currentWindow: true, active: true}, async (tabs) => {
    const result = await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, func: () => {return localStorage['authorization.token']} })
    
    const auth = result[0].result.substring(1, result[0].result.length-1)
    const regexedString = tabs[0].url.match(/https:\/\/kide\.app\/(en\/|fi\/|sv\/)?events\/([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})/)

    if(!regexedString || regexedString.length==1) {
        container.innerHTML = "<h2>Please navigate to the event page an reload this script!</h2>"
        return
    }

    const id = regexedString[2]
    document.getElementById("reserveButton").addEventListener("click", async (e) => {
        //Get value of amount field
        const amountField = document.getElementById("amount").value
        const amount = amountField ? amountField : 1
        //Get values of optional, user-given fields
        const type = document.getElementById("type").value
        const price = document.getElementById("price").value
        const keywords = [...document.querySelectorAll(".keyword button:nth-child(1)")].map((button) => ({text: button.textContent, optional: button.classList.contains("optional")}))

        //Map adjacent optional keywords to a single string
        let keywordString = ""
        let lastWasOptional = false
        let first = true
        for (const keyword of keywords) {
            if (keyword.optional) {
                if (lastWasOptional) {
                    keywordString += "|"
                } else if (!first) {
                    keywordString += ","
                }
                keywordString += keyword.text
                lastWasOptional = true
            } else {
                if (!first) {
                    keywordString += ","
                }
                keywordString += keyword.text
                lastWasOptional = false
            }
            first = false
        }


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
        container.innerHTML = startTime-now>0 ? "<h2>Waiting for the sales to start</h2>" : ""
        await sleep(startTime-now >= 0 ? startTime-now : 0)
        addMessage("Begin script", 0)

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

        let successful = false

        let firstIteration = true

        while(!successful) {

            let toCreates = []
            let variant = 0

            //If there is no maximum amount, reserve every type
            if(!maxTotalReservationsPerCheckout) {
                firstIteration && addMessage("Reservations not limited. Reserving the amount specified of every ticket.", 2)
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
                        if(pricePerItem==price) {
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

                let v = variants[variant]
                toCreates.push({"inventoryId": v['inventoryId'], "quantity": Math.min(amount, maxTotalReservationsPerCheckout)})
                firstIteration && addMessage("Reservations limited. Trying to reserve ticket " + v['name']+".", 2)
            }

            //Reservation
            let successes = await makeReservation(toCreates, auth)
            successful = successes.length>0
            addMessage(successful ? 'Reservation successful!' : 'Reservation failed, trying again', successful ? 0 : 1)

            if(successful) {
                chrome.tabs.reload()
            }

            /**
             * The following code is redundant, but it's here if it's needed in the future
             * Now days Kide.app requires a X-Requested-Id header to be set, which is a hash of the inventoryId
             * Thus only one item category can be reserved at a time
             */

            /**
            *
            let variantIndex = 0
            //If the reservation fails try every variant one at a time
            while(maxTotalReservationsPerCheckout && !successful) {
                toCreates=[]
                addMessage("Error, trying again", 1)
                let v=variants[variantIndex]
                addMessage("Trying to reserve ticket " + v['name']+".", 2)
                toCreates.push({"inventoryId": v['inventoryId'], "quantity":Math.min(amount, maxTotalReservationsPerCheckout)})

                //Reservation
                reservationPost = await makeReservation(toCreates, auth)
                addMessage("Status: "+reservationPost.status, 1)
                const result = await isSuccessful(reservationPost)
                successful = result['successful']
                reservationJson = result['reservationJson']

                if(successful) {
                    chrome.tabs.reload()
                }

                variantIndex = variantIndex+1
                if(variantIndex>=variants.length) {
                    break
                }
            }

            //If the availability info is wrong, we need to try again without the variant that failed
            while(!maxTotalReservationsPerCheckout && !successful) {
                addMessage("Error, trying again", 1)
                let errorInventoryId = reservationJson?.['error']?.['entity']?.['inventoryId']

                let newVariants = []

                for(const v of toCreates) {
                    if(v['inventoryId']!=errorInventoryId) {
                        newVariants.push(v)
                    }
                }

                toCreates = newVariants

                //Reservation
                reservationPost = await makeReservation(toCreates, auth)
                addMessage("Status: "+reservationPost.status, 1)
                const result = await isSuccessful(reservationPost)
                successful = result['successful']
                reservationJson = result['reservationJson']

                if(successful) {
                    chrome.tabs.reload()
                }
            }
            *
            **/

            //addMessage("Response JSON", 1)
            //addMessage(`${JSON.stringify(reservationJson)}`, 2)

            if(successful) {
                const successfulVariants = successes.map((s) => variants.find((v) => v['inventoryId']==s.value))
                const reservations = successfulVariants.map((v) => ({variantName: v['name'], reservedQuantity: toCreates.find((t) => t['inventoryId']==v['inventoryId'])['quantity']}))
                const reservationsText = reservations.map((r) => `${r['reservedQuantity']} of ticket ${r['variantName']}`).join(', ')
                addMessage("Reserved " + reservationsText+".", 2)
                addMessage("This box can now be closed.", 2)
            }
            
            firstIteration = false
        }
    })

    // Keyword handler
    const keywordContainer = document.getElementById("keywordContainer")
    const keywordsInput = document.getElementById("keywordsInput")
    const addKeywordButton = document.getElementById("addKeywordButton")

    // Create a function to add a keyword element
    function addKeywordElement(keyword, isRequired) {
        const keywordElement = document.createElement("div")
        keywordElement.classList.add("keyword")

        const keywordButton = document.createElement("button")
        keywordButton.textContent = keyword

        // Add a class based on whether it's required or optional
        if (isRequired) {
            keywordButton.classList.add("required")
        } else {
            keywordButton.classList.add("optional")
        }

        // Add an event listener to toggle the required/optional status
        keywordButton.addEventListener("click", () => {
            keywordButton.classList.toggle("required")
            keywordButton.classList.toggle("optional")
        });

        // Add an event listener to remove the keyword
        const removeButton = document.createElement("button")
        removeButton.textContent = "x"
        removeButton.classList.add("remove-button")
        removeButton.addEventListener("click", () => {
            keywordElement.remove()
        });

        keywordElement.appendChild(keywordButton)
        keywordElement.appendChild(removeButton)
        keywordContainer.appendChild(keywordElement)
    }

    // Add event listener to the "Add" button
    addKeywordButton.addEventListener("click", () => {
        const keyword = keywordsInput.value.trim()
        if (keyword !== "") {
            addKeywordElement(keyword, true); // By default, keywords are required
            keywordsInput.value = "" // Clear the input field
        }
    })
})
