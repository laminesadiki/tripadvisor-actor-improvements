const Apify = require('apify');
const { handleSearch, handleVacationRentalList, handleVacationRentalDetail } = require('./routes');
const csvToJson = require('csvtojson');
const { Session } = require('apify/build/session_pool/session');
const { SESSION_RETIRED } = require('apify/build/session_pool/events').default;

process.env.API_KEY = '3c7beec8-846d-4377-be03-71cae6145fdc';

const {
    resolveInBatches,
    getRequestListSources,
    getClient,
    randomDelay,
    validateInput,
    getReviews,
} = require('./tools/general');

const { processRestaurant } = require('./tools/restaurant-tools');
const { processHotel } = require('./tools/hotel-tools');
const { processAttraction, getAttractions , getAttractionDetail } = require('./tools/attraction-tools');

const {
    getLocationId,
    buildRestaurantUrl,
    getPlaceInformation,
    getAttractionInformation,
    getVacationInformation,
    getLocationIdByCityAndCountry,
    callForRestaurantList,
    callForHotelList,
    callForReview,
} = require('./tools/api');

const { LIMIT } = require('./constants');

const { utils: { log, requestAsBrowser, sleep } } = Apify;

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');

    const {
        locationFullName,
        locationId: locationIdInput,
        googlesheetLink,
        includeVacationRentals = true,
        includeRestaurants = true,
        includeHotels = true,
        includeReviews = true,
        includeAttractions = true,
        lastReviewDate,
        checkInDate,
        proxyConfiguration,
    } = input;

    log.debug('Received input', input);
    global.INCLUDE_REVIEWS = includeReviews;
    global.LAST_REVIEW_DATE = lastReviewDate;
    global.CHECKIN_DATE = checkInDate;
    if (input.proxyConfiguration.useApifyProxy) {
        global.PROXY_GROUPS = input.proxyConfiguration && input.proxyConfiguration.apifyProxyGroups;
    } else {
        global.PROXY_GROUPS = ['SHADER'];
    }

    global.LANGUAGE = input.language || 'en';
   
    const [ googlesheet ] = googlesheetLink.match(/.*\/spreadsheets\/d\/.*\//);
        const sourceUrl = `${googlesheet}gviz/tq?tqx=out:csv`;
        const response = await requestAsBrowser({ url: sourceUrl, encoding: 'utf8' });
    
        const rows = await csvToJson().fromString(response.body);
        log.info('Google sheets rows = ' + rows.length);
        let sourcesList=[];
        
        for (let index = 0; index < rows.length; index++) {
            let { type,id_datatourisme,id_tripadvisor:id,url_tripadvisor:urlTrip} = rows[index];
            let searchType = type.trim().toLowerCase();
            let url;
            if(input.language === "fr"){
                url = urlTrip.includes(".com") ? urlTrip.replace(".com",".fr") : urlTrip.replace(".co.uk",".fr");
            }
            sourcesList.push({url,id,userData:{id_datatourisme,searchType}});
        }
    let requestList = new Apify.RequestList({
        sources: sourcesList,
    });
    await requestList.initialize();
    

    let locationId;

    const sessionClients = {};
    const listenerAdded = false;
    const uniqueRowIdList = new Set();
    
    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        handlePageTimeoutSecs: 600,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 40,
            createSessionFunction: async (sessionPool) => {
                const session = new Session({ sessionPool });
                if (!sessionClients[session.id]) {
                    try {
                        sessionClients[session.id] = await getClient(session);
                    } catch (e) {
                        log.warning(`Could not create create for session due to: ${e.message}`);
                    }
                }
                if (!listenerAdded) {
                    sessionPool.on(SESSION_RETIRED, ses => delete sessionClients[ses.id]);
                }
                return session;
            },
        },
        launchPuppeteerOptions: {
            ...proxyConfiguration,
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async (context) => {
            const { request,page, session } = context;
            
            const { url,id , userData : {searchType} } = request;
            
            console.log('Page opened.', {url,id,searchType});
            // console.log(`Page opened { id : ${id}}`);
       
            const client = sessionClients[session.id] || await getClient(session);
            
            if(searchType == "hotel"){
                const hotel = await getPlaceInformation(id, session);
                await processHotel(hotel, client,session,request,page);
            }
            else if (searchType == "restaurant"){
                const restaurant = await getPlaceInformation(id, session);
                await processRestaurant(restaurant, client,session,request,page);
            }
            else if(searchType == "things to do"){
                const attraction = await getAttractionInformation(id,session);
                await getAttractionDetail(attraction, client,session,request);
            }
            else if(searchType == "vacation rental"){
                return handleVacationRentalDetail({request,page}, client);
            }  
            
        },

        gotoFunction: async ({ page, request }) => {
            await Apify.utils.puppeteer.blockRequests(page, {
                urlPatterns: [".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip", "gstatic", 
                                "bing", "doubleclick", "connect.facebook", "google-analytics" ],
            });
            
            return page.goto(request.url, { timeout: 120000 });
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');

    if (uniqueRowIdList.size > 0) {
        const uniqueResultIDs = new Set();
        await sleep(10000);
        const dataset = await Apify.openDataset();
        const { itemCount } = await dataset.getInfo();
        log.info('itemCount=' + itemCount);

        await dataset.forEach(async (item, index) => {
            uniqueResultIDs.add(item.rowId);
        });

        const difference = [...uniqueRowIdList].filter(x => !uniqueResultIDs.has(x));
        for (let index = 0; index < difference.length; index++) {
            const rowId = difference[index];
            await Apify.pushData({
                rowId,
            });
        }
    }
});
