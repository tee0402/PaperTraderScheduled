const functions = require("firebase-functions");
const admin = require("firebase-admin");
const fetch = require("node-fetch");
admin.initializeApp();

exports.scheduled = functions.pubsub.schedule('0 17 * * 1-5').timeZone('America/New_York').onRun(async (context) => {
    const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
    const holidaysDoc = await holidaysDocRef.get();
    const holidays = holidaysDoc.data().dates;
    const today = new Date().toLocaleDateString("en-US", {timeZone: "America/New_York"});
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
            const cash = Number(docData.cash);
            const positions = docData.positions;
            const positionsShares = positions.map(position => docData.positionsShares[position]);
    
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

// exports.updatePortfolioValues = functions.https.onRequest(async (request, response) => {
//     const holidaysDocRef = admin.firestore().collection("holidays").doc("holidays");
//     const holidaysDoc = await holidaysDocRef.get();
//     const holidays = holidaysDoc.data().dates;
//     const today = new Date().toLocaleDateString("en-US", {timeZone: "America/New_York"});
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
//             const cash = Number(docData.cash);
//             const positions = docData.positions;
//             const positionsShares = positions.map(position => docData.positionsShares[position]);
    
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