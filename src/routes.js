const Apify = require('apify');

const {
    getReviews,
} = require('./tools/general');

const { processRestaurant } = require('./tools/restaurant-tools');
const { processHotel } = require('./tools/hotel-tools');
const { processAttraction } = require('./tools/attraction-tools');

const { callForLocationDetail } = require('./tools/api');

const { utils: { log, sleep } } = Apify;

exports.handleSearch = async ({ request, page, session }, requestQueue, client) => {
    const { rowId, name, type, locationId } = request.userData;

    await page.waitForSelector('div.result-title');

    let searchType;
    if (type === 'vacation rental') {
        searchType = 'vacation rental';
    } else if (type === 'hotel') {
        searchType = 'hotel';
    } else if (type === 'restaurant') {
        searchType = 'restaurant';
    } else if (type === 'things to do') {
        searchType = 'things to do';
    }

    const detailUrl = await page.evaluate((searchType, searchName) => {
        let url;
        const list = document.querySelectorAll('div.result-title');

        for (let index = 0; index < list.length; index++) {
            const element = list[index];
            const onclick = element.onclick.toString();
            const isMatchSearchType = onclick.includes("'" + searchType + "'");

            if (isMatchSearchType && element.textContent.trim().toLowerCase().includes(searchName.toLowerCase())) {
                if (searchType === 'VACATION_RENTALS') {
                    url = onclick.match(/VacationRentalReview-.+\.html/g)[0];
                } else if (searchType === 'HOTELS') {
                    url = onclick.match(/Hotel_Review-.+\.html/g)[0];
                } else if (searchType === 'RESTAURANTS') {
                    url = onclick.match(/Restaurant_Review-.+\.html/g)[0];
                } else if (searchType === 'ATTRACTIONS') {
                    url = onclick.match(/Attraction_Review-.+\.html/g)[0];
                }
                
                break;
            }
        }

        return url;
    }, searchType, name);

    if (!detailUrl) {
        log.info(`Cannot find ${type}: ${name} (${rowId})`);
        return;
    }

    const detailLocationId = detailUrl.match(/-d(\d+)-/)[1];

    if (type === 'vacation rental') {
        const domain = request.url.match(/https:\/\/.+\//g);
        const url = domain + detailUrl;
    
        await requestQueue.addRequest({ url, userData: { label: 'DETAIL', rowId } });
    } else {
        const locationDetail = await callForLocationDetail(detailLocationId, session);

        const result = {
            rowId,
            ...locationDetail,
        }

        log.info(`Processing ${type}: ${name}`);
        if (type === 'hotel') {
            await processHotel(result, client, locationId);
        } else if (type === 'restaurant') {
            await processRestaurant(result, client, locationId);
        } else if (type === 'things to do') {
            await processAttraction(result, locationId, session);
        }
    }
};

exports.handleVacationRentalList = async ({ request, page }, requestQueue) => {
    const locationId = request.url.match(/-g(\d+)-/)[1];

    const links = await page.evaluate(() => {
        const list = document.querySelectorAll('a[href*="VacationRentalReview"]');
        const result = [];        
        for (let index = 0; index < list.length; index++) {
            const link = list[index];
            if (link.href && link.href.endsWith('.html')) {
                // TODO: https://www.tripadvisor.co.uk/Search?geo=186338&q=SGS%20-%20Refurbished%203%20Bedroom%20in%20Pimlico%2C%20London&ssrc=v
                // not have address
                // const ele = document.querySelector(`a[href="${link.href}"] + div > div > div > div`);
                // const address = ele? ele.textContent : null;
                result.push({
                    url: link.href,
                    address: undefined
                });
            }
        }

        return result;
    });

    for (let index = 0; index < links.length; index++) {
        const { url, address } = links[index];
        console.log(address);
        await requestQueue.addRequest({ url, userData: { label: 'DETAIL', address } });
    }

    if (request.userData.firstPage) {
        const pageNumbers = await page.evaluate(() => {
            const lastPage = document.querySelector('.pageNumbers a:last-child');
            return lastPage? lastPage.textContent : null;
        });

        if (pageNumbers) {
            const pageTotal = parseInt(pageNumbers);
            for (let index = 1; index <= pageTotal; index++) {
                const offset = 50 * index;
                const url = `https://www.tripadvisor.com/VacationRentals-g${locationId}-${offset ? `oa${offset}` : ''}.html`;
                await requestQueue.addRequest({ url, userData: { label: 'LIST', firstPage: false } });
            }
        }
    }
};

exports.handleVacationRentalDetail = async ({ request, page }, client) => {
    const { rowId, address } = request.userData;

    const detailLocationId = request.url.match(/-d(\d+)-/)[1];

    // Click on Map tab and wait google map display
    await page.click('#taplc_vr_rental_detail_page_nav_0 div div:nth-child(5)'); // Map tab
    try {
        await page.evaluate('document.querySelector("div#vr-detail-page-map").scrollIntoView(true)');
        await page.waitForSelector('a[href*="https://maps.google.com/maps?ll="]');
       
    } catch (e) {
        // ignores
    }

    const data = await page.evaluate(() => {
        const scriptData = document.querySelector('script[type="application/ld+json"]').textContent;
        const json = JSON.parse(scriptData);
        const { name, aggregateRating , image , areaServed , description} = json;
        
        let latitude = null,
            longitude = null;

        const googleMapLink = document.querySelector('a[href*="https://maps.google.com/maps?ll="]');
        if (googleMapLink) {
            const coords = googleMapLink.href.match(/ll=(.*?)&/)[1].split(',');
            latitude = coords[0];
            longitude = coords[1];
        }
        
      
        let ele = document.querySelector('.ppr_priv_vr_traveler_inputs_and_rap');
        let parts = ele? ele.textContent.match(/From(.+\d+)/) : null;
        if (!parts && ele) {
            parts = ele.textContent.match(/Rate for 1 night(.+?\d+)/);
        }

        // ele = document.querySelector('#vr-detail-page-overview > div > div:nth-child(2) > div:first-child');
        ele = document.querySelector('div._2bZ4gZhI');
        const overview = ele? ele.textContent : '';
        let arr = overview.match(/(\d+)\s+chambre[s]*/);
        const chambres = arr? arr[1] : null;
        arr = overview.match(/(\d+)\s+salles de bain[s]*/);
        const salles_de_bains = arr? arr[1] : null;
        arr = overview.match(/(\d+)\s+personne[s]*/);
        const personnes = arr? arr[1] : null;
        arr = overview.match(/(\d+)\s+nuit[s]* minimum/);
        const nuits = arr? arr[1] : null;

        ele = document.querySelector('#vr-detail-page-overview > div > div:nth-child(2) > div:nth-child(2)');
        const category = ele? ele.textContent : null;

        const amenities = [];
        const list = document.querySelectorAll('#vr-detail-page-amenities > div > div:nth-child(3) > div');
        if (list) {
            for (let index = 0; index < list.length; index++) {
                const amenity = list[index];
                amenities.push(amenity.textContent.trim());
            }
        }

        return {
            name,
            description,
            areaServed,
            image,
            category,
            pricePerNight: parts? parts[1] : null,
            latitude,
            longitude,
            rating: aggregateRating? aggregateRating.ratingValue : null,
            chambres,
            salles_de_bains,
            personnes,
            nuits,
            numberOfReviews: aggregateRating? aggregateRating.reviewCount : null,
            amenities,
        }
    });

    let reviews = [];
    if (global.INCLUDE_REVIEWS) {
        try {
            reviews = await getReviews(detailLocationId, client);
        } catch (e) {
            log.error('Could not get reviews', e);
        }
    }

    const result = {
        rowId,
        id_datatourisme : request.userData.id_datatourisme,
        id_tripadvisor: detailLocationId,
        type: 'vacation rental',
        webUrl: request.url,
        address,
        ...data,
        reviews,
    }

    await Apify.pushData(result);
};


