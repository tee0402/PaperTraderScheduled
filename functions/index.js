import { pubsub, https } from "firebase-functions";
import admin from "firebase-admin";
import fetch from "node-fetch";
import moment from "moment-timezone";
admin.initializeApp();

export const scheduledUpdatePortfolios = pubsub.schedule("0 17 * * 1-5").timeZone("America/New_York").onRun(async context => {
    const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
    const holidaysDoc = await holidaysDocRef.get();
    const holidays = holidaysDoc.data().dates;
    const today = moment().tz("America/New_York").format("YYYY-MM-DD");
    if (holidays[0] === today) {
        holidays.shift();
        return holidaysDocRef.update("dates", holidays).then(() => "success").catch(error => error);
    } else {
        const users = admin.firestore().collection("users");
        return users.get().then(snapshot => snapshot.forEach(async doc => {
            const docData = doc.data();
            const dates = docData.dates;
            dates.push(today);
            const portfolioValues = docData.portfolioValues;
            let cash = Number(docData.cash);
            const positions = docData.positions;
            const positionsShares = positions.map(position => docData.positionsShares[position]);

            await users.doc(doc.id).collection("history").where("paid", "==", false)
            .where("date", ">", moment.tz(today + " 16:00", "America/New_York").toDate())
            .where("date", "<", moment.tz(today + " 18:00", "America/New_York").toDate()).get().then(async pendingDividendDocs => {
                await Promise.all(pendingDividendDocs.docs.map(pendingDividendDoc => {
                    const pendingDividendData = pendingDividendDoc.data();
                    cash += Number(pendingDividendData.shares) * Number(pendingDividendData.dividend);
                    return users.doc(doc.id).collection("history").doc(pendingDividendDoc.id).update("paid", true);
                }));
                return users.doc(doc.id).update("cash", cash.toFixed(2));
            });

            const fetchPromises = positions.map(position => fetch("https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=" + position + "&apikey=1275"));
            return Promise.all(fetchPromises).then(async fetchResponses => {
                const jsonPromises = fetchResponses.map(fetchResponse => fetchResponse.json());
                return Promise.all(jsonPromises).then(jsons => {
                    const quotes = jsons.map(json => Number(json["Global Quote"]["05. price"]));
                    const portfolioValue = quotes.reduce((previousValue, currentValue, currentIndex) => previousValue + currentValue * Number(positionsShares[currentIndex]), cash).toFixed(2);
                    portfolioValues.push(portfolioValue);
                    const a = users.doc(doc.id).update("dates", dates);
                    const b = users.doc(doc.id).update("portfolioValues", portfolioValues);
                    return Promise.all([a, b]);
                });
            });
        })).then(() => "success").catch(error => error);
    }
});

// export const updatePortfolios = https.onRequest(async (request, response) => {
//     const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
//     const holidaysDoc = await holidaysDocRef.get();
//     const holidays = holidaysDoc.data().dates;
//     const today = moment().tz("America/New_York").format("YYYY-MM-DD");
//     if (holidays[0] === today) {
//         holidays.shift();
//         return holidaysDocRef.update("dates", holidays).then(() => response.send({result: "success"})).catch(error => response.send(error));
//     } else {
//         const users = admin.firestore().collection("users");
//         return users.get().then(snapshot => snapshot.forEach(async doc => {
//             const docData = doc.data();
//             const dates = docData.dates;
//             dates.push(today);
//             const portfolioValues = docData.portfolioValues;
//             let cash = Number(docData.cash);
//             const positions = docData.positions;
//             const positionsShares = positions.map(position => docData.positionsShares[position]);

//             await users.doc(doc.id).collection("history").where("paid", "==", false)
//             .where("date", ">", moment.tz(today + " 16:00", "America/New_York").toDate())
//             .where("date", "<", moment.tz(today + " 18:00", "America/New_York").toDate()).get().then(async pendingDividendDocs => {
//                 await Promise.all(pendingDividendDocs.docs.map(pendingDividendDoc => {
//                     const pendingDividendData = pendingDividendDoc.data();
//                     cash += Number(pendingDividendData.shares) * Number(pendingDividendData.dividend);
//                     return users.doc(doc.id).collection("history").doc(pendingDividendDoc.id).update("paid", true);
//                 }));
//                 return users.doc(doc.id).update("cash", cash.toFixed(2));
//             });

//             const fetchPromises = positions.map(position => fetch("https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=" + position + "&apikey=1275"));
//             return Promise.all(fetchPromises).then(async fetchResponses => {
//                 const jsonPromises = fetchResponses.map(fetchResponse => fetchResponse.json());
//                 return Promise.all(jsonPromises).then(jsons => {
//                     const quotes = jsons.map(json => Number(json["Global Quote"]["05. price"]));
//                     const portfolioValue = quotes.reduce((previousValue, currentValue, currentIndex) => previousValue + currentValue * Number(positionsShares[currentIndex]), cash).toFixed(2);
//                     portfolioValues.push(portfolioValue);
//                     const a = users.doc(doc.id).update("dates", dates);
//                     const b = users.doc(doc.id).update("portfolioValues", portfolioValues);
//                     return Promise.all([a, b]);
//                 });
//             });
//         })).then(() => response.send({result: "success"})).catch(error => response.send(error));
//     }
// });

export const scheduledAddPendingDividends = pubsub.schedule("30 9 * * 1-5").timeZone("America/New_York").onRun(async context => {
    const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
    const holidaysDoc = await holidaysDocRef.get();
    const holidays = holidaysDoc.data().dates;
    const today = moment().tz("America/New_York").format("YYYY-MM-DD");
    if (holidays[0] !== today) {
        const users = admin.firestore().collection("users");
        return users.get().then(snapshot => snapshot.forEach(async doc => {
            const docData = doc.data();
            const positions = docData.positions;
            const positionsShares = positions.map(position => docData.positionsShares[position]);

            const fetchPromises = positions.map(position => fetch("https://api.polygon.io/v3/reference/dividends?ticker=" + position + "&ex_dividend_date=" + today + "&apiKey=lTkAIOnwJ9vpjDvqYAF0RWt9yMkhD0up"));
            return Promise.all(fetchPromises).then(async fetchResponses => {
                const jsonPromises = fetchResponses.map(fetchResponse => fetchResponse.json());
                return Promise.all(jsonPromises).then(async jsons => {
                    for (let i = 0; i < jsons.length; i++) {
                        const resultsArray = jsons[i]["results"];
                        if (resultsArray.length === 1) {
                            const resultObject = resultsArray[0];
                            await users.doc(doc.id).collection("history").add({
                                date: moment.tz(resultObject.pay_date + " 17:00", "America/New_York").toDate(),
                                dividend: String(resultObject.cash_amount),
                                paid: false,
                                shares: positionsShares[i],
                                ticker: positions[i]
                            });
                        }
                    }
                });
            });
        })).then(() => "success").catch(error => error);
    }
});

// export const addPendingDividends = https.onRequest(async (request, response) => {
//     const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
//     const holidaysDoc = await holidaysDocRef.get();
//     const holidays = holidaysDoc.data().dates;
//     const today = moment().tz("America/New_York").format("YYYY-MM-DD");
//     if (holidays[0] !== today) {
//         const users = admin.firestore().collection("users");
//         return users.get().then(snapshot => snapshot.forEach(async doc => {
//             const docData = doc.data();
//             const positions = docData.positions;
//             const positionsShares = positions.map(position => docData.positionsShares[position]);

//             const fetchPromises = positions.map(position => fetch("https://api.polygon.io/v3/reference/dividends?ticker=" + position + "&ex_dividend_date=" + today + "&apiKey=lTkAIOnwJ9vpjDvqYAF0RWt9yMkhD0up"));
//             return Promise.all(fetchPromises).then(async fetchResponses => {
//                 const jsonPromises = fetchResponses.map(fetchResponse => fetchResponse.json());
//                 return Promise.all(jsonPromises).then(async jsons => {
//                     for (let i = 0; i < jsons.length; i++) {
//                         const resultsArray = jsons[i]["results"];
//                         if (resultsArray.length === 1) {
//                             const resultObject = resultsArray[0];
//                             await users.doc(doc.id).collection("history").add({
//                                 date: moment.tz(resultObject.pay_date + " 17:00", "America/New_York").toDate(),
//                                 dividend: String(resultObject.cash_amount),
//                                 paid: false,
//                                 shares: positionsShares[i],
//                                 ticker: positions[i]
//                             });
//                         }
//                     }
//                 });
//             });
//         })).then(() => response.send({result: "success"})).catch(error => response.send(error));
//     }
// });