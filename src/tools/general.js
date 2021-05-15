const axios = require('axios');
const Apify = require('apify');
const cheerio = require('cheerio');
const moment = require('moment');
const check = require('check-types');

const {
    callForReview,
    buildVacationRentalUrl,
    buildHotelUrl,
    buildRestaurantUrl,
    buildAttractionsUrl,
    getAgentOptions,
    getReviewTagsForLocation,
} = require('./api');

const { utils: { log } } = Apify;

function randomDelay(minimum = 200, maximum = 600) {
    const min = Math.ceil(minimum);
    const max = Math.floor(maximum);
    return Apify.utils.sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

function getSecurityToken($) {
    let securityToken = null;
    $('head script').each((index, element) => {

        if ($(element).get()[0].children[0] && $(element).get()[0].children[0].data.includes("define('page-model', [], function() { return ")) {
            let scriptText = $(element).get()[0].children[0].data;
            scriptText = scriptText.replace("define('page-model', [], function() { return ", '');
            scriptText = scriptText.replace('; });', '');
            const scriptObject = JSON.parse(scriptText);
            securityToken = scriptObject.JS_SECURITY_TOKEN;
        }
    });
    return securityToken;
}

function getCookies(response) {
    let sessionCookie = null;
    let taudCookie = null;
    response.headers['set-cookie'].forEach((d) => {
        if (d.includes('TASession')) {
            [sessionCookie] = d.split(';');
        }
        if (d.includes('TAUD')) {
            [taudCookie] = d.split(';');
        }
    });
    return `${sessionCookie};${taudCookie}`;
}

async function resolveInBatches(promiseArray, batchLength = 10) {
    const promises = [];
    for (const promise of promiseArray) {
        if (typeof promise === 'function') {
            promises.push(promise());
        } else {
            promises.push(promise);
        }
        if (promises.length % batchLength === 0) await Promise.all(promises);
    }
    return Promise.all(promises);
}

const processReview = (review, remoteId) => {
    const { text, title, rating, tripInfo, publishedDate, userProfile } = review;
    const stayDate = tripInfo ? tripInfo.stayDate : null;
    let userLocation = null;
    let userContributions = null;

    log.debug(`Processing review: ${title}`);
    if (userProfile) {
        const { hometown, contributionCounts = {} } = userProfile;
        const { sumReview } = contributionCounts;
        userContributions = sumReview;
        userLocation = hometown.fallbackString;

        if (hometown.location) {
            userLocation = hometown.location.additionalNames.long;
        }
    }

    return {
        text,
        title,
        rating,
        stayDate,
        publishedDate,
        userLocation,
        userContributions,
        remoteId,
    };
};

function findLastReviewIndex(reviews, dateKey) {
    return reviews.findIndex((r) => {
        let rDate;
        if (dateKey) {
            rDate = moment(r[dateKey]);
        } else {
            rDate = moment(r.publishedDate);
        }
        const userMaxDate = moment(global.LAST_REVIEW_DATE);
        return rDate.isBefore(userMaxDate);
    });
}

async function getReviews(id, client) {
    const result = [];
    let offset = 0;
    const limit = 20;
    let numberOfFetches = 0;

    try {
        const resp = await callForReview(id, client, offset, limit);
        const { errors } = resp.data[0];

        if (errors) {
            log.error('Graphql error', errors);
        }

        const reviewData = resp.data[0].data.locations[0].reviewList || {};
        const { totalCount } = reviewData;
        let { reviews = [] } = reviewData;
        const lastIndex = findLastReviewIndex(reviews);
        const shouldSlice = lastIndex >= 0;
        if (shouldSlice) {
            reviews = reviews.slice(0, lastIndex);
        }
        const needToFetch = totalCount - limit;

        log.info(`Going to process ${totalCount} reviews`);

        numberOfFetches = Math.ceil(needToFetch / limit);

        if (reviews.length >= 1) {
            reviews.forEach(review => result.push(processReview(review)));
        }

        if (shouldSlice) return result;
    } catch (e) {
        log.error(e, 'Could not make initial request');
    }
    let response;

    try {
        for (let i = 0; i < numberOfFetches; i++) {
            offset += limit;
            response = await callForReview(id, client, offset, limit);
            const reviewData = response.data[0].data.locations[0].reviewList;
            let { reviews } = reviewData;
            const lastIndex = findLastReviewIndex(reviews);
            const shouldSlice = lastIndex >= 0;
            if (shouldSlice) {
                reviews = reviews.slice(0, lastIndex);
            }
            reviews.forEach(review => result.push(processReview(review)));
            if (shouldSlice) break;
            await Apify.utils.sleep(300);
        }
    } catch (e) {
        log.error(e, 'Could not make additional requests');
    }
    return result;
}

function getRequestListSources(locationId, includeHotels, includeRestaurants, includeAttractions, includeVacationRentals) {
    const sources = [];
    if (includeHotels) {
        sources.push({
            url: buildHotelUrl(locationId),
            userData: { initialHotel: true },
        });
    }
    if (includeRestaurants) {
        sources.push({
            url: buildRestaurantUrl(locationId),
            userData: { initialRestaurant: true },
        });
    }
    if (includeAttractions) {
        sources.push({
            url: buildAttractionsUrl(locationId),
            userData: {
                initialAttraction: true,
            },
        });
    }
    if (includeVacationRentals) {
        sources.push({
            url: buildVacationRentalUrl(locationId),
            userData: { label: 'LIST', firstPage: true },
        });
    }
    return sources;
}

async function getClient(session) {
    const response = await axios.get('https://www.tripadvisor.com/Hotels-g28953-New_York-Hotels.html', getAgentOptions(session));
    const $ = cheerio.load(response.data);
    return axios.create({
        baseURL: 'https://www.tripadvisor.co.uk/data/graphql',
        headers: {
            'x-requested-by': getSecurityToken($),
            Cookie: getCookies(response),
        },
        ...getAgentOptions(session),
    });
}

function validateInput(input) {
    const {
        locationFullName,
        googlesheetLink,
        includeReviews,
        lastReviewDate,
        includeRestaurants,
        includeHotels,
        includeAttractions,
        includeVacationRentals,
        checkInDate,
    } = input;
    const getError = (property, type = 'string') => new Error(`${property} should be a ${type}`);
    const checkStringProperty = (property, propertyName) => {
        if (property && !check.string(property)) {
            throw getError(propertyName);
        }
    };
    const checkBooleanProperty = (property, propertyName) => {
        if (property && !check.boolean(property)) {
            throw getError(propertyName, 'boolean');
        }
    };

    const checkDateFormat = (date, format = 'YYYY-MM-DD') => {
        if (moment(date, format).format(format) !== date) {
            throw new Error(`Date: ${date} should be in format ${format}`);
        }
    };

    // Check types
    // strings
    checkStringProperty(locationFullName, 'locationFullName');
    checkStringProperty(googlesheetLink, 'googlesheetLink');
    checkStringProperty(lastReviewDate, 'lasReviewData');

    // boleans
    checkBooleanProperty(includeRestaurants, 'includeRestaurants');
    checkBooleanProperty(includeHotels, 'includeHotels');
    checkBooleanProperty(includeReviews, 'includeReviews');
    checkBooleanProperty(includeAttractions, 'includeAttractions');

    // dates
    if (lastReviewDate) {
        checkDateFormat(lastReviewDate);
    }
    if (checkInDate) {
        checkDateFormat(checkInDate);
    }

    // Should have all required fields
    if (!locationFullName && !googlesheetLink) {
        throw new Error('At least one of properties: locationFullName, googlesheetLink should be set');
    }

    if (locationFullName && !includeHotels && !includeRestaurants && !includeAttractions && !includeVacationRentals) {
        throw new Error('At least one of properties: includeHotels or includeRestaurants or includeAttractions or includeVacationRentals should be true');
    }

    log.info('Input validation OK');
}

async function getReviewTags(locationId,session) {
    let tags = [];
    let offset = 0;
    const limit = 50;
    const data = await getReviewTagsForLocation(locationId,session, limit);
    tags = tags.concat(data.data);
    let reviewTags = tags;
    let reviewTagsObject = tags.map(el => {return {[el.text] : el.review_count}});
    let ReviewTagsArray = tags.map(el => el.text);
    let reviewTagsString = tags.map(el => el.text).join(" ; ");

    return {reviewTagsObject , ReviewTagsArray};
}

// get Rating Notes in About Section :
/* return an object like that :
{
cleanliness: "4.5/5",
Location: "4/5",
Service: "4.5/5",
Value: "4.5/5",
}
*/
const hotelAboutRatingNotes = async (page) => {
  
    const data = await page.evaluate(() => {
        let listRatings = [...document.querySelectorAll("div._1krg1t5y")];
  
        let newList = listRatings.map((el) => {
            let critere = el.querySelector("div._1h7NKZWM").innerText;
            let note = parseInt(el.querySelector("span").className.slice(-2)) / 10;
            return { [critere]: note };
      });
  
      let objRating = Object.assign({}, ...newList);
      return objRating;
    });
    
    return data;
};

const restaurantAboutRatingNotes = async (page) => {
  
    const data = await page.evaluate(() => {
        let listRatings = [...document.querySelectorAll("div.jT_QMHn2")];
  
        let newList = listRatings.map((el) => {
            let critere = el.querySelector("span._2vS3p6SS").innerText;
            let note = parseInt(el.querySelector("span._377onWB- > span").className.slice(-2)) / 10;
            return { [critere]: note };
      });
  
      let objRating = Object.assign({}, ...newList);
      return objRating;
    });
    
    return data;
};

module.exports = {
    hotelAboutRatingNotes,
    restaurantAboutRatingNotes,
    resolveInBatches,
    getRequestListSources,
    getClient,
    randomDelay,
    validateInput,
    getReviewTags,
    getReviews,
    findLastReviewIndex,
};
