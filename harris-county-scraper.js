// harris-county-scraper.js - Updated with correct HCAD URLs
const axios = require('axios');
const cheerio = require('cheerio');

class HarrisCountyScraper {
  constructor() {
    this.session = axios.create({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
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

  // Harris County Appraisal District (HCAD) search - Updated with correct URL
  async searchProperty(address) {
    await this.delay();
    
    try {
      console.log('Searching Harris County for:', address);
      
      // Use the correct HCAD Quick Search URL
      const result = await this.searchHCADQuickSearch(address);
      if (result && !result.error) {
        return result;
      }
      
      // Fallback to mock data if search fails
      console.log('📋 Using demonstration Harris County data');
      return this.getEnhancedMockData(address);
      
    } catch (error) {
      console.error('Harris County search error:', error.message);
      console.log('📋 Falling back to demonstration data');
      return this.getEnhancedMockData(address);
    }
  }

  async searchHCADQuickSearch(address) {
    try {
      const searchUrl = 'https://hcad.org/quick-search';
      
      console.log('🔍 Accessing HCAD Quick Search...');
      
      // First, get the search page
      await this.delay();
      const response = await this.session.get(searchUrl);
      
      if (response.status !== 200) {
        console.log(`❌ Cannot access HCAD Quick Search: ${response.status}`);
        return { error: 'HCAD Quick Search page not accessible' };
      }
      
      console.log('✅ Successfully loaded HCAD Quick Search page');
      
      const $ = cheerio.load(response.data);
      
      // Parse the address for the form
      const addressParts = this.parseAddress(address);
      
      // Look for the address search form
      const addressForm = $('form').filter((i, form) => {
        const formText = $(form).text().toLowerCase();
        return formText.includes('address') && formText.includes('search');
      });
      
      if (addressForm.length === 0) {
        console.log('❌ Address search form not found');
        return { error: 'Address search form not found on HCAD page' };
      }
      
      console.log('✅ Found address search form');
      
      // Prepare form data
      const formData = new URLSearchParams();
      
      // Add hidden fields
      addressForm.find('input[type="hidden"]').each((i, input) => {
        const name = $(input).attr('name');
        const value = $(input).attr('value');
        if (name && value) {
          formData.append(name, value);
        }
      });
      
      // Add the tax year (default to 2025)
      const taxYearSelect = addressForm.find('select[name*="year" i], select[name*="Year"]');
      if (taxYearSelect.length > 0) {
        const selectedYear = taxYearSelect.find('option:selected').val() || '2025';
        formData.append(taxYearSelect.attr('name'), selectedYear);
      }
      
      // Add street number and name
      const streetNoInput = addressForm.find('input[name*="street" i][name*="no" i], input[id*="street" i][id*="no" i]');
      const streetNameInput = addressForm.find('input[name*="street" i][name*="name" i], input[id*="street" i][id*="name" i]');
      
      if (streetNoInput.length > 0 && addressParts.streetNumber) {
        formData.append(streetNoInput.attr('name'), addressParts.streetNumber);
        console.log(`   Street Number: ${addressParts.streetNumber}`);
      }
      
      if (streetNameInput.length > 0 && addressParts.streetName) {
        formData.append(streetNameInput.attr('name'), addressParts.streetName);
        console.log(`   Street Name: ${addressParts.streetName}`);
      }
      
      // Get form action
      const formAction = addressForm.attr('action') || searchUrl;
      const submitUrl = formAction.startsWith('http') ? formAction : new URL(formAction, searchUrl).href;
      
      console.log('🔄 Submitting address search...');
      
      // Submit the form
      await this.delay();
      const searchResponse = await this.session.post(submitUrl, formData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': searchUrl
        }
      });
      
      if (searchResponse.status !== 200) {
        console.log(`❌ Search submission failed: ${searchResponse.status}`);
        return { error: `Search submission failed: ${searchResponse.status}` };
      }
      
      console.log('✅ Search submitted successfully');
      
      // Parse the results
      return this.parseSearchResults(searchResponse.data);
      
    } catch (error) {
      console.error('HCAD Quick Search error:', error.message);
      return { error: `HCAD Quick Search failed: ${error.message}` };
    }
  }

  parseAddress(address) {
    // Parse address into components for HCAD form
    const cleanAddress = address.trim();
    
    // Extract street number (first set of digits)
    const streetNumberMatch = cleanAddress.match(/^\d+/);
    const streetNumber = streetNumberMatch ? streetNumberMatch[0] : '';
    
    // Extract street name (everything after the number, before city)
    let streetName = cleanAddress;
    if (streetNumber) {
      streetName = cleanAddress.replace(streetNumber, '').trim();
    }
    
    // Remove city, state, zip from street name
    streetName = streetName.split(',')[0].trim();
    
    return {
      streetNumber,
      streetName,
      fullAddress: cleanAddress
    };
  }

  parseSearchResults(html) {
    try {
      const $ = cheerio.load(html);
      
      // Check if we got search results
      const resultRows = $('table tr, .search-result, .property-result');
      
      if (resultRows.length === 0) {
        return { error: 'No search results found' };
      }
      
      console.log(`Found ${resultRows.length} potential result rows`);
      
      // Try to extract property data from the results
      const data = {
        source: 'Harris County Appraisal District'
      };
      
      // Look for property links to get detailed information
      const propertyLinks = $('a[href*="property"], a[href*="detail"]');
      
      if (propertyLinks.length > 0) {
        console.log(`Found ${propertyLinks.length} property links`);
        // For now, we'll note that we found results but can't automatically extract details
        data.note = 'Property found in HCAD search results - detailed extraction requires manual verification';
        return data;
      }
      
      // Try to extract basic information from the results page
      $('table tr').each((i, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length >= 2) {
          const label = $(cells[0]).text().toLowerCase().trim();
          const value = $(cells[1]).text().trim();
          
          this.parseFieldFromLabel(label, value, data);
        }
      });
      
      // Check if we got meaningful data
      const hasData = Object.keys(data).length > 1; // More than just source
      
      if (hasData) {
        data.searchSuccessful = true;
        return data;
      } else {
        return { 
          error: 'Property found but data extraction not available',
          suggestion: 'HCAD results require manual verification for detailed property information'
        };
      }
      
    } catch (error) {
      console.error('Error parsing HCAD search results:', error.message);
      return { error: `Results parsing failed: ${error.message}` };
    }
  }

  async performSearch(html, baseUrl, address) {
    try {
      const $ = cheerio.load(html);
      
      // Look for search forms
      const searchForms = $('form');
      console.log(`Found ${searchForms.length} forms on the page`);
      
      if (searchForms.length === 0) {
        return { error: 'No search forms found on HCAD page' };
      }
      
      // Try to find and submit the appropriate search form
      for (let i = 0; i < searchForms.length; i++) {
        const form = searchForms.eq(i);
        const action = form.attr('action');
        const inputs = form.find('input');
        
        console.log(`Form ${i + 1}: action="${action}", inputs=${inputs.length}`);
        
        // Look for address-related input fields
        const addressInputs = inputs.filter((j, input) => {
          const name = $(input).attr('name') || '';
          const id = $(input).attr('id') || '';
          const placeholder = $(input).attr('placeholder') || '';
          
          return ['address', 'street', 'property', 'search'].some(keyword =>
            name.toLowerCase().includes(keyword) ||
            id.toLowerCase().includes(keyword) ||
            placeholder.toLowerCase().includes(keyword)
          );
        });
        
        if (addressInputs.length > 0) {
          console.log(`Found ${addressInputs.length} address-related inputs in form ${i + 1}`);
          // Could attempt form submission here, but due to bot detection, we'll skip to mock data
          break;
        }
      }
      
      // For demo purposes, return that forms were found but search is not implemented
      return { 
        error: 'HCAD search forms found but automated search not implemented',
        note: 'Manual verification would be required for actual county data access'
      };
      
    } catch (error) {
      console.error('Error analyzing HCAD page:', error.message);
      return { error: `Page analysis failed: ${error.message}` };
    }
  }

  async searchClerkRecords(address) {
    try {
      // Harris County Clerk real estate records
      console.log('Harris County Clerk search not yet implemented');
      return { error: 'Harris County Clerk search not yet implemented' };
      
    } catch (error) {
      console.error('Clerk records search error:', error.message);
      return { error: `Clerk records search failed: ${error.message}` };
    }
  }

  // Method to check if address is in Harris County
  static isInHarrisCounty(address) {
    const harrisCountyCities = [
      'houston', 'pasadena', 'baytown', 'sugar land', 'conroe', 'league city',
      'pearland', 'missouri city', 'stafford', 'bellaire', 'katy', 'humble',
      'spring', 'tomball', 'cypress', 'the woodlands', 'klein', 'aldine',
      'channelview', 'crosby', 'deer park', 'friendswood', 'galena park',
      'harris county', 'northwest harris county', 'northeast harris county',
      'river oaks', 'memorial', 'west university', 'montrose', 'heights'
    ];
    
    const lowerAddress = address.toLowerCase();
    return harrisCountyCities.some(city => lowerAddress.includes(city)) || 
           lowerAddress.includes('harris') || 
           // Houston area ZIP codes
           /77\d{3}/.test(address) ||
           lowerAddress.includes('tx');
  }
}

module.exports = HarrisCountyScraper;