const Apify = require('apify');

const { utils: { log } } = Apify;
const { getReviews, getReviewTags, randomDelay , hotelAboutRatingNotes } = require('./general');

const { LIMIT } = require('../constants');

const {
    callForHotelList,
} = require('./api');

async function getHotels(locationId, session) {
    let hotels = [];
    const initialRequest = await callForHotelList(locationId, session);
    const maxOffset = initialRequest.paging.total_results;
    log.info(`Processing restaurants with last data offset: ${maxOffset}`);
    for (let i = 0; i <= maxOffset; i += LIMIT) {
        log.info(`Processing hotel list with offset ${i}`);
        const hotelList = await callForHotelList(locationId, session, LIMIT, i);
        hotels = hotels.concat(hotelList.data);
    }

    return hotels;            
}

async function processHotel(placeInfo, client,session, request,page) {
    const { location_id: id, rowId } = placeInfo;
    let reviews = [];

    if (global.INCLUDE_REVIEWS) {
        try {
            reviews = await getReviews(id, client);
        } catch (e) {
            log.error('Could not get reviews', e);
        }
    }

    const tags = await getReviewTags(id,session);
    const AboutRatingNotes = await hotelAboutRatingNotes(page);
    const noteAttributed = {
        horrible : placeInfo.rating_histogram.count_1,
        "médiocre" : placeInfo.rating_histogram.count_2,
        moyen : placeInfo.rating_histogram.count_3,
        "très bien" : placeInfo.rating_histogram.count_4,
        excellent : placeInfo.rating_histogram.count_5,
    }
    const place = {
        id_datatourisme : request.userData.id_datatourisme,
        rowId,
        id_tripadvisor: placeInfo.location_id,
        type: "hotel",
        name: placeInfo.name,
        photo: placeInfo.photo,
        awards: placeInfo.awards && placeInfo.awards.map(award => ({ year: award.year, name: award.display_name })),
        rankingPosition: placeInfo.ranking_position,
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
        AboutRatingNotes
    };
    if (global.INCLUDE_REVIEW_TAGS) {
        const tags = await getReviewTags(id);
        place.reviewTags = tags;
    }
    log.debug('Data for hotel: ', place);
    await Apify.pushData(place);
}

module.exports = {
    processHotel,
    getHotels,
};
