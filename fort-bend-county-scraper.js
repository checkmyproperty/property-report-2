const axios = require('axios');
const cheerio = require('cheerio');

class FortBendCountyScraper {
  constructor() {
    this.session = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache'
      }
    });
    
    this.lastRequest = 0;
    this.minDelay = 2000; // 2 seconds between requests
  }

  async delay() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    
    if (timeSinceLastRequest < this.minDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.minDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequest = Date.now();
  }

  // Fort Bend County Appraisal District (FBCAD) search
  async searchProperty(address) {
    await this.delay();
    
    try {
      console.log('Searching Fort Bend County for:', address);
      
      // Option 1: Try FBCAD property search
      let result = await this.searchFBCAD(address);
      if (result && !result.error) {
        return result;
      }
      
      // Option 2: Try Fort Bend County Clerk records
      result = await this.searchClerkRecords(address);
      if (result && !result.error) {
        return result;
      }
      
      // If both fail, return the error from FBCAD (most detailed)
      return result || { error: 'No Fort Bend County property data found' };
      
    } catch (error) {
      console.error('Fort Bend County search error:', error.message);
      return { error: `Fort Bend County search failed: ${error.message}` };
    }
  }

  async searchFBCAD(address) {
    try {
      console.log('Attempting to access Fort Bend County (FBCAD) data...');
      
      // Fort Bend County websites often have server issues (500 errors)
      // We'll try a few different approaches with better error handling
      
      const searchUrls = [
        'https://fbcad.org/property-search/',
        'https://www.fbcad.org/property-search/',
        'https://fbcad.org/',
        'https://www.fbcad.org/'
      ];
      
      for (const searchUrl of searchUrls) {
        try {
          console.log(`Trying FBCAD URL: ${searchUrl}`);
          await this.delay();
          
          // Add more headers to appear like a regular browser
          const response = await this.session.get(searchUrl, {
            headers: {
              ...this.session.defaults.headers,
              'Sec-Fetch-Site': 'none',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-User': '?1',
              'Sec-Fetch-Dest': 'document'
            },
            timeout: 10000 // Reduce timeout for faster failover
          });
          
          if (response.status === 200) {
            console.log('✅ Successfully connected to FBCAD');
            
            // Try to parse the response for search capabilities
            const $ = cheerio.load(response.data);
            
            // Look for any search functionality
            const searchElements = $('form, input[type="search"], input[name*="search"], input[name*="address"]');
            
            if (searchElements.length > 0) {
              console.log('Found search elements, attempting property lookup...');
              
              // Try to perform search (this may still fail with 500)
              const result = await this.attemptPropertySearch($, searchUrl, address);
              if (result && !result.error) {
                return result;
              }
            }
            
            // If we get here, the website is accessible but search failed
            console.log('Website accessible but search functionality unavailable');
            break;
          }
          
        } catch (error) {
          console.log(`URL ${searchUrl} failed: ${error.response?.status} ${error.message}`);
          
          // If we get a 500 error, it means the server is having issues
          if (error.response?.status === 500) {
            console.log('⚠️  Fort Bend County website experiencing server errors (HTTP 500)');
            return { 
              error: 'Fort Bend County website experiencing server errors (HTTP 500)',
              statusMessage: 'County website is temporarily unavailable' 
            };
          }
          
          // Continue trying other URLs for other types of errors
          continue;
        }
      }
      
      // All attempts failed - return an error
      return { 
        error: 'Fort Bend County website is not accessible',
        statusMessage: 'Unable to connect to FBCAD property search system'
      };
      
    } catch (error) {
      console.error('FBCAD search error:', error.message);
      return { error: `FBCAD search failed: ${error.message}` };
    }
  }

  async attemptPropertySearch($, baseUrl, address) {
    try {
      // Look for search forms
      const searchForm = $('form').first();
      if (!searchForm.length) {
        return { error: 'No search form found' };
      }
      
      // Extract form details
      const action = searchForm.attr('action') || baseUrl;
      const method = (searchForm.attr('method') || 'GET').toUpperCase();
      
      // Build form data
      const formData = new URLSearchParams();
      
      // Add any hidden inputs
      searchForm.find('input[type="hidden"]').each((i, input) => {
        const name = $(input).attr('name');
        const value = $(input).attr('value');
        if (name && value) {
          formData.append(name, value);
        }
      });
      
      // Try common field names for address search
      const addressFields = [
        'address', 'search', 'searchValue', 'query', 
        'propertyAddress', 'streetAddress', 'searchText'
      ];
      
      let addressFieldFound = false;
      
      // Check existing form fields
      searchForm.find('input[type="text"], input[type="search"]').each((i, input) => {
        const name = $(input).attr('name') || '';
        const id = $(input).attr('id') || '';
        
        if (addressFields.some(field => 
          name.toLowerCase().includes(field.toLowerCase()) || 
          id.toLowerCase().includes(field.toLowerCase())
        )) {
          formData.append(name, address);
          addressFieldFound = true;
        }
      });
      
      // If no address field found, add common ones
      if (!addressFieldFound) {
        addressFields.forEach(field => {
          formData.append(field, address);
        });
      }
      
      // Build full URL
      const searchUrl = action.startsWith('http') ? action : new URL(action, baseUrl).href;
      
      console.log(`Submitting search for: ${address}`);
      await this.delay();
      
      // Perform the search
      let response;
      try {
        if (method === 'POST') {
          response = await this.session.post(searchUrl, formData, {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': baseUrl
            },
            timeout: 15000
          });
        } else {
          response = await this.session.get(searchUrl, { 
            params: Object.fromEntries(formData),
            timeout: 15000
          });
        }
        
        if (response.status === 200) {
          return this.extractFBCADPropertyData(cheerio.load(response.data));
        }
        
      } catch (searchError) {
        if (searchError.response?.status === 500) {
          console.log('⚠️  Search resulted in server error (500) - Fort Bend County systems may be down');
          return { 
            error: 'Fort Bend County website experiencing technical difficulties',
            suggestion: 'County website is temporarily unavailable'
          };
        }
        throw searchError;
      }
      
      return { error: 'Search completed but no data found' };
      
    } catch (error) {
      console.error('Property search attempt failed:', error.message);
      return { error: `Property search failed: ${error.message}` };
    }
  }

  async submitSearch($, form, baseUrl, address) {
    try {
      // Extract form data
      const actionUrl = form.attr('action') || baseUrl;
      const method = form.attr('method') || 'GET';
      
      const formData = {};
      form.find('input, select, textarea').each((i, element) => {
        const $el = $(element);
        const name = $el.attr('name');
        const type = $el.attr('type');
        
        if (name) {
          if (type === 'hidden') {
            formData[name] = $el.attr('value') || '';
          } else if ($el.is('select')) {
            formData[name] = $el.find('option:first').attr('value') || '';
          } else {
            // Assume this is the address field
            formData[name] = address;
          }
        }
      });
      
      // Common field names to try for address
      const addressFields = ['address', 'search', 'query', 'searchValue', 'propertyAddress'];
      addressFields.forEach(field => {
        if (!formData[field]) {
          formData[field] = address;
        }
      });
      
      await this.delay();
      
      let response;
      const fullActionUrl = actionUrl.startsWith('http') ? actionUrl : new URL(actionUrl, baseUrl).href;
      
      if (method.toLowerCase() === 'post') {
        response = await this.session.post(fullActionUrl, formData);
      } else {
        response = await this.session.get(fullActionUrl, { params: formData });
      }
      
      if (response.status === 200) {
        return this.extractFBCADPropertyData(cheerio.load(response.data));
      }
      
      return { error: 'Search form submission failed' };
      
    } catch (error) {
      console.error('Form submission error:', error.message);
      return { error: `Form submission failed: ${error.message}` };
    }
  }

  extractFBCADPropertyData($) {
    try {
      // Extract property details from FBCAD page
      const extractText = (selector) => {
        const element = $(selector).first();
        return element.length ? element.text().trim() : null;
      };
      
      const extractNumber = (text) => {
        if (!text) return null;
        const number = text.replace(/[^\d.-]/g, '');
        return number ? parseFloat(number) : null;
      };
      
      // FBCAD specific selectors - adjust based on actual HTML structure
      const data = {
        // Property basics
        propertyType: extractText('.property-type') || extractText('[data-field="property-type"]'),
        yearBuilt: extractNumber(extractText('.year-built') || extractText('[data-field="year-built"]')),
        
        // Building details
        livingArea: extractNumber(extractText('.living-area') || extractText('[data-field="living-area"]')),
        bedrooms: extractNumber(extractText('.bedrooms') || extractText('[data-field="bedrooms"]')),
        bathrooms: extractNumber(extractText('.bathrooms') || extractText('[data-field="bathrooms"]')),
        totalRooms: extractNumber(extractText('.total-rooms') || extractText('[data-field="total-rooms"]')),
        
        // Lot information
        lotSize: extractNumber(extractText('.lot-size') || extractText('[data-field="lot-size"]')),
        
        // Assessment values
        assessedValue: extractNumber(extractText('.assessed-value') || extractText('[data-field="assessed-value"]')),
        landValue: extractNumber(extractText('.land-value') || extractText('[data-field="land-value"]')),
        improvementValue: extractNumber(extractText('.improvement-value') || extractText('[data-field="improvement-value"]')),
        
        // Tax information
        taxAmount: extractNumber(extractText('.tax-amount') || extractText('[data-field="tax-amount"]')),
        
        // Owner information
        owner: extractText('.owner-name') || extractText('[data-field="owner-name"]'),
        mailingAddress: extractText('.mailing-address') || extractText('[data-field="mailing-address"]'),
        
        // Additional details
        constructionType: extractText('.construction-type') || extractText('[data-field="construction-type"]'),
        garage: extractText('.garage') || extractText('[data-field="garage"]'),
        parkingSpaces: extractNumber(extractText('.parking-spaces') || extractText('[data-field="parking-spaces"]')),
        
        // Source identifier
        source: 'Fort Bend County Appraisal District'
      };
      
      // Alternative extraction using table rows (common FBCAD format)
      $('tr').each((i, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length >= 2) {
          const label = $(cells[0]).text().toLowerCase().trim();
          const value = $(cells[1]).text().trim();
          
          if (label.includes('year built') || label.includes('year constructed')) {
            data.yearBuilt = extractNumber(value);
          }
          if (label.includes('living area') || label.includes('heated area') || label.includes('square feet')) {
            data.livingArea = extractNumber(value);
          }
          if (label.includes('bedrooms') || label.includes('beds')) {
            data.bedrooms = extractNumber(value);
          }
          if (label.includes('bathrooms') || label.includes('baths')) {
            data.bathrooms = extractNumber(value);
          }
          if (label.includes('lot size') || label.includes('land area') || label.includes('acres')) {
            data.lotSize = extractNumber(value);
          }
          if (label.includes('assessed value') || label.includes('total value') || label.includes('market value')) {
            data.assessedValue = extractNumber(value);
          }
          if (label.includes('land value')) {
            data.landValue = extractNumber(value);
          }
          if (label.includes('improvement value') || label.includes('building value')) {
            data.improvementValue = extractNumber(value);
          }
          if (label.includes('owner') || label.includes('taxpayer')) {
            data.owner = value;
          }
          if (label.includes('mailing') || label.includes('address')) {
            data.mailingAddress = value;
          }
          if (label.includes('construction') || label.includes('building type')) {
            data.constructionType = value;
          }
        }
      });
      
      // Try to extract from definition lists (dl/dt/dd structure)
      $('dt').each((i, dt) => {
        const label = $(dt).text().toLowerCase().trim();
        const value = $(dt).next('dd').text().trim();
        
        if (label.includes('year built')) data.yearBuilt = extractNumber(value);
        if (label.includes('living area')) data.livingArea = extractNumber(value);
        if (label.includes('bedrooms')) data.bedrooms = extractNumber(value);
        if (label.includes('bathrooms')) data.bathrooms = extractNumber(value);
        if (label.includes('lot size')) data.lotSize = extractNumber(value);
        if (label.includes('assessed value')) data.assessedValue = extractNumber(value);
        if (label.includes('owner')) data.owner = value;
      });
      
      // Clean up and validate data
      Object.keys(data).forEach(key => {
        if (data[key] === '' || data[key] === null || data[key] === undefined) {
          data[key] = null;
        }
      });
      
      // Check if we got any meaningful data
      const hasData = data.assessedValue || data.yearBuilt || data.livingArea || data.owner;
      
      return hasData ? data : { error: 'No property data found in FBCAD page' };
      
    } catch (error) {
      console.error('Error extracting FBCAD data:', error.message);
      return { error: `Data extraction failed: ${error.message}` };
    }
  }

  async searchClerkRecords(address) {
    try {
      // Fort Bend County Clerk real estate records search
      // This is typically for deed records, sales, etc.
      const clerkUrl = 'https://www.fortbendcountytx.gov/';
      
      // Implementation would depend on the actual clerk search interface
      // For now, return a placeholder indicating this is not implemented
      return { error: 'Fort Bend County Clerk search not yet implemented' };
      
    } catch (error) {
      console.error('Clerk records search error:', error.message);
      return { error: `Clerk records search failed: ${error.message}` };
    }
  }

  // Method to check if address is in Fort Bend County
  static isInFortBendCounty(address) {
    const fortBendCountyCities = [
      'sugar land', 'missouri city', 'pearland', 'rosenberg', 'richmond',
      'stafford', 'katy', 'fulshear', 'needville', 'simonton', 'cinco ranch',
      'first colony', 'sienna plantation', 'new territory', 'mission bend',
      'fort bend county', 'fort bend'
    ];
    
    const lowerAddress = address.toLowerCase();
    return fortBendCountyCities.some(city => lowerAddress.includes(city)) || 
           (lowerAddress.includes('texas') || lowerAddress.includes('tx'));
  }
}

module.exports = FortBendCountyScraper;