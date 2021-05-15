const Apify = require('apify');

const { utils: { log } } = Apify;
const { getReviews, getReviewTags,restaurantAboutRatingNotes } = require('./general');

const { LIMIT } = require('../constants');

const {
    callForRestaurantList,
} = require('./api');

function getHours(placeInfo) {
    const placeHolder = [];

    if (!placeInfo.hours) {
        return placeHolder;
    }

    if (!placeInfo.hours.week_ranges) {
        return placeHolder;
    }

    return placeInfo.hours.week_ranges.map(wR => wR.map(day => ({ open: day.open_time, close: day.close_time })));
}

async function getRestaurants(locationId, session) {
    let restaurants = [];
    const initialRequest = await callForRestaurantList(locationId, session);
    const maxOffset = initialRequest.paging.total_results;
    log.info(`Processing restaurants with last data offset: ${maxOffset}`);
    for (let i = 0; i <= maxOffset; i += LIMIT) {
        log.info(`Processing restaurant list with offset ${i}`);
        const restaurantList = await callForRestaurantList(locationId, session, LIMIT, i);
        restaurants = restaurants.concat(restaurantList.data);
    }

    return restaurants;            
}

async function processRestaurant(placeInfo, client,session, request,page) {
    const { location_id: id, rowId } = placeInfo;

    let reviews = [];
    if (global.INCLUDE_REVIEWS) {
        try {
            reviews = await getReviews(id, client);
        } catch (e) {
            log.error('Could not get reviews', e);
        }
    }
    if (!placeInfo) {
        return;
    }

    const tags = await getReviewTags(id,session);
    const AboutRatingNotes = await restaurantAboutRatingNotes(page);
    
    const noteAttributed = {
        horrible : placeInfo.rating_histogram.count_1,
        "médiocre" : placeInfo.rating_histogram.count_2,
        moyen : placeInfo.rating_histogram.count_3,
        "très bon" : placeInfo.rating_histogram.count_4,
        excellent : placeInfo.rating_histogram.count_5,
    }

    const place = {
        id_datatourisme : request.userData.id_datatourisme,
        rowId,
        id_tripadvisor: placeInfo.location_id,
        type: 'restaurant',
        photo : placeInfo.photo,
        name: placeInfo.name,
        awards: placeInfo.awards && placeInfo.awards.map(award => ({ year: award.year, name: award.display_name })),
        rankingPosition: placeInfo.ranking_position,
        priceLevel: placeInfo.price_level,
        category: placeInfo.ranking_category,
        rating: placeInfo.rating,
        isClosed: placeInfo.is_closed,
        isLongClosed: placeInfo.is_long_closed,
        phone: placeInfo.phone,
        address: placeInfo.address,
        email: placeInfo.email,
        cuisine: placeInfo.cuisine && placeInfo.cuisine.map(cuisine => cuisine.name),
        mealTypes: placeInfo.mealTypes && placeInfo.mealTypes.map(m => m.name),
        hours: getHours(placeInfo),
        latitude: placeInfo.latitude,
        longitude: placeInfo.longitude,
        webUrl: placeInfo.web_url,
        website: placeInfo.website,
        numberOfReviews: placeInfo.num_reviews,
        rankingDenominator: placeInfo.ranking_denominator,
        rankingString: placeInfo.ranking,
        reviews,
        TagsObject : tags.reviewTagsObject,
        TagsArray : tags.ReviewTagsArray,
        noteAttributed,
        AboutRatingNotes
    };
    if (global.INCLUDE_REVIEW_TAGS) {
        place.reviewTags = await getReviewTags(id);
    }
    log.debug('Data for restaurant: ', place);

    await Apify.pushData(place);
}

module.exports = {
    processRestaurant,
    getRestaurants,
};
