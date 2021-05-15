const querystring = require('querystring');
const axios = require('axios');
const Apify = require('apify');
const ProxyAgent = require('proxy-agent');

const { ReviewQuery } = require('./graphql-queries');
const { LIMIT } = require('../constants');

function callForReview(placeId = 300974, client, offset = 0, limit = 100) {
    return client.post('/batched',
        [{
            operationName: 'ReviewListQuery',
            variables: {
                locationId: placeId,
                offset,
                filters: [],
                prefs: null,
                initialPrefs: {},
                limit,
                filterCacheKey: null,
                prefsCacheKey: 'hotelReviewPrefs',
                needKeywords: false,
                keywordVariant: 'location_keywords_v2_llr_order_30_en',
            },
            query: ReviewQuery,
        }]);
}

async function getLocationId(searchString, session) {
    const queryString = querystring.stringify({
        query: searchString,
        alternate_tag_name: true,
        auto_broaden: true,
        category_type: 'neighborhoods,geos',
        currency: 'USD',

    });
    let error;
    let result;
    try {
        const url = `https://api.tripadvisor.com/api/internal/1.14/typeahead?${queryString}&lang=${global.LANGUAGE}`;
        result = await axios.post(
            url,
            {},
            {
                headers: {
                    'X-TripAdvisor-API-Key': process.env.API_KEY,
                },
                ...getAgentOptions({ id: session }) },
        );
    } catch (e) {
        error = e;
    }
   
    const { data } = result.data;

    if (!data || error) {
        throw new Error(`Could not find location "${searchString}" reason: ${error.message}`);
    }

    return data[0].result_object.location_id;
}

async function getLocationIdByCityAndCountry(city, country, session) {
    const queryString = querystring.stringify({
        query: city,
        alternate_tag_name: true,
        auto_broaden: true,
        category_type: 'neighborhoods,geos',
        currency: 'USD',

    });
    let error;
    let result;
    try {
        const url = `https://api.tripadvisor.com/api/internal/1.14/typeahead?${queryString}&lang=${global.LANGUAGE}`;
        result = await axios.post(
            url,
            {},
            {
                headers: {
                    'X-TripAdvisor-API-Key': process.env.API_KEY,
                },
                ...getAgentOptions({ id: session }) },
        );
    } catch (e) {
        error = e;
    }

    const { data } = result.data;

    if (!data || error) {
        throw new Error(`Could not find location "${city}", "${country}" reason: ${error.message}`);
    }

    for (let index = 0; index < data.length; index++) {
        const location = data[index].result_object;
        const { ancestors } = location;

        if (ancestors.length > 0) {
            const locationCountry = ancestors[ancestors.length - 1].name;

            if (location.name.toLowerCase() === city.toLowerCase() && locationCountry.toLowerCase() === country.toLowerCase()) {
                return location.location_id;
            }
        }
    }
}

async function getPlaceInformation(placeId, session) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${placeId}?&lang=${global.LANGUAGE}`;

    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

async function getAttractionInformation(placeId, session) {
    // const url = `https://api.tripadvisor.com/api/internal/1.14/location/${placeId}/attractions?&lang=${global.LANGUAGE}`;
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${placeId}?lang=${global.LANGUAGE}`;
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });
    return response.data;
}

async function getVacationInformation(placeId, session) {
    const url = `https://api.tripadvisor.com/api/internal/2.0/location/${placeId}/VacationRentals?&lang=${global.LANGUAGE}`;
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });
    return response.data;
}

function buildVacationRentalUrl(locationId, offset) {
    return `https://www.tripadvisor.com/VacationRentals-g${locationId}-${offset ? `oa${offset}` : ''}.html`;
}

function buildRestaurantUrl(locationId, offset) {
    return `https://www.tripadvisor.com/RestaurantSearch?Action=PAGE&geo=${locationId}&ajax=1&sortOrder=relevance&${offset ? `o=a${offset}` : ''}&availSearchEnabled=false`;
}

function buildHotelUrl(locationId, offset) {
    return `https://www.tripadvisor.com/Hotels-g${locationId}-${offset ? `oa${offset}` : ''}.html`;
}

function buildAttractionsUrl(locationId) {
    return `https://www.tripadvisor.com/Attractions-g${locationId}`;
}

async function callForAttractionList(locationId, session, limit = 10, offset = 0) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/attractions?limit=${limit}&offset=${offset}`;
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });
    return response.data;
}

async function callForAttractionReview(locationId, session, limit = 10, offset = 0) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/reviews?limit=${limit}&offset=${offset}`;

    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

async function getReviewTagsForLocation(locationId, session, limit = LIMIT, offset = 0) {
    // const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/keywords?currency=USD&lang=${global.LANGUAGE}&limit=${limit}&offset=${offset}`;
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/keywords`;
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

async function callForRestaurantList(locationId, session, limit = LIMIT, offset = 0) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/restaurants?currency=USD&lang=${global.LANGUAGE}&limit=${limit}&offset=${offset}`;
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

async function callForHotelList(locationId, session, limit = LIMIT, offset = 0) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}/all?currency=USD&lang=${global.LANGUAGE}&limit=${limit}&offset=${offset}&category=hotels`;
    
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

async function callForLocationDetail(locationId, session) {
    const url = `https://api.tripadvisor.com/api/internal/1.14/location/${locationId}?currency=USD&lang=${global.LANGUAGE}`;
    
    const response = await axios.get(
        url,
        { headers: { 'X-TripAdvisor-API-Key': process.env.API_KEY, Cookie: session.getCookieString(url) }, ...getAgentOptions(session) },
    );
    session.setCookiesFromResponse({ headers: response.headers, url });

    return response.data;
}

function getAgentOptions(session) {
    if (!global.PROXY_GROUPS) {
        return {};
    }
    const proxyUrl = Apify.getApifyProxyUrl({
        password: process.env.APIFY_PROXY_PASSWORD,
        groups: global.PROXY_GROUPS,
        session: session.id,
    });
    const agent = new ProxyAgent(proxyUrl);
    return {
        httpsAgent: agent,
        httpAgent: agent,
    };
}

module.exports = {
    callForReview,
    getLocationId,
    getLocationIdByCityAndCountry,
    getPlaceInformation,
    getAttractionInformation,
    getVacationInformation,
    buildVacationRentalUrl,
    buildHotelUrl,
    buildRestaurantUrl,
    getAgentOptions,
    getReviewTagsForLocation,
    callForRestaurantList,
    callForHotelList,
    buildAttractionsUrl,
    callForAttractionList,
    callForAttractionReview,
    callForLocationDetail,
};
