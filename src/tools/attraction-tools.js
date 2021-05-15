const Apify = require('apify');

const { utils: { log } } = Apify;
const { callForAttractionList, callForAttractionReview } = require('./api');
const { findLastReviewIndex , getReviewTags} = require('./general');

async function getAttractions(locationId, session) {
    let attractions = [];
    let offset = 0;
    const limit = 20;
    const data = await callForAttractionList(locationId, session, limit);
    attractions = attractions.concat(data.data);
    if (data.paging && data.paging.next) {
        const totalResults = data.paging.total_results;
        const numberOfRuns = Math.ceil(totalResults / limit);
        log.info(`Going to process ${numberOfRuns} pages of attractions`);
        for (let i = 0; i <= numberOfRuns; i++) {
            offset += limit;
            log.info(`Processing attraction list with offset ${offset}`);
            const data2 = await callForAttractionList(locationId, session, limit, offset);
            attractions = attractions.concat(data2.data);
        }
    }
    return attractions;
}

function processAttractionReview(review) {
    const {
        lang,
        text,
        published_date: publishedDate,
        rating,
        travel_date: travelDate,
        user,
        title,
        machine_translated: machineTranslated,
        subratings,
    } = review;

    return {
        language: lang,
        title,
        text,
        publishedDate,
        rating,
        travelDate,
        user: {
            username: user.username,
            helpfulVotes: user.helpful_votes,

        },
        subratings,
        machineTranslated,
    };
}

async function getReviewsForAttraction(locationId, session) {
    const reviews = [];
    let offset = 0;
    const limit = 50;
    const data = await callForAttractionReview(locationId, session, limit);
    let { data: revs } = data;
    let lastIndex = findLastReviewIndex(revs, 'published_date');
    let shouldSlice = lastIndex >= 0;
    if (shouldSlice) {
        revs = revs.slice(0, lastIndex);
    }
    revs.forEach(review => reviews.push(processAttractionReview(review)));
    if (shouldSlice) return reviews;
    if (data.paging && data.paging.next) {
        const totalResults = data.paging.total_results;
        const numberOfRuns = Math.ceil(totalResults / limit);
        log.info(`Going to process ${numberOfRuns} pages of reviews`);
        for (let i = 0; i <= numberOfRuns; i++) {
            offset += limit;
            let { data: reviewsToPush } = await callForAttractionReview(locationId, session, limit, offset);
            lastIndex = findLastReviewIndex(reviewsToPush, 'published_date');
            shouldSlice = lastIndex >= 0;
            if (shouldSlice) {
                reviewsToPush = reviewsToPush.slice(0, lastIndex);
            }
            reviewsToPush.forEach(review => reviews.push(processAttractionReview(review)));
            if (shouldSlice) break;
        }
    }
    return reviews;
}

async function getAttractionDetail(placeInfo,client, session,request) {
    const { location_id: locationId, rowId } = placeInfo;

    let reviews = [];
    if (global.INCLUDE_REVIEWS) {
        try {
            reviews = await getReviewsForAttraction(request.id, session);
            log.info(`Got ${reviews.length} reviews for ${placeInfo.name}`);
        } catch (e) {
            log.error(`Could not get reviews for attraction ${placeInfo.name} due to ${e.message}`);
        }
    }

    // attraction.reviews = reviews;
    const tags = await getReviewTags(locationId,session);
    const noteAttributed = {
        horrible : placeInfo.rating_histogram.count_1,
        "médiocre" : placeInfo.rating_histogram.count_2,
        moyen : placeInfo.rating_histogram.count_3,
        "très bon" : placeInfo.rating_histogram.count_4,
        excellent : placeInfo.rating_histogram.count_5,
    }

    const result = {
        id_tripadvisor: placeInfo.location_id,
        id_datatourisme : request.userData.id_datatourisme,
        rowId,
        type: 'things to do',
        // ...attraction.data[0],
        name: placeInfo.name,
        photo: placeInfo.photo,
        awards: placeInfo.awards && placeInfo.awards.map(award => ({ year: award.year, name: award.display_name })),
        rankingPosition: placeInfo.ranking_position,
        // ...reviews,
        priceLevel: placeInfo.price_level,
        price: placeInfo.price,
        category: placeInfo.ranking_category,
        rating: placeInfo.rating,
        hotelClass: placeInfo.hotel_class,
        hotelClassAttribution: placeInfo.hotel_class_attribution,
        phone: placeInfo.phone,
        address: placeInfo.address,
        email: placeInfo.email,
        amenities: placeInfo.amenities && placeInfo.amenities.map(amenity => amenity.name),
        latitude: placeInfo.latitude,
        longitude: placeInfo.longitude,
        webUrl: placeInfo.web_url,
        website: placeInfo.website,
        rankingString: placeInfo.ranking,
        numberOfReviews: placeInfo.num_reviews,
        rankingDenominator: placeInfo.ranking_denominator,
        reviews,
        TagsObject : tags.reviewTagsObject,
        TagsArray : tags.ReviewTagsArray,
        noteAttributed,
    }


    

    return Apify.pushData(result);
}

async function processAttraction(attraction, locationId, session,request) {
    const attr = await getAttractionDetail(attraction, locationId, session);
    return Apify.pushData(attr);
}

async function processAttraction2(placeInfo, client, request) {
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
    const place = {
        id_datatourisme : request.userData.id_datatourisme,
        rowId,
        id_tripadvisor: placeInfo.location_id,
        type: 'RESTAURANT',
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
    };
    if (global.INCLUDE_REVIEW_TAGS) {
        place.reviewTags = await getReviewTags(id);
    }
    log.debug('Data for restaurant: ', place);

    await Apify.pushData(place);
}

module.exports = {
    processAttraction,
    getAttractions,
    getAttractionDetail
};
