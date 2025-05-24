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
      },
      maxRedirects: 5
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

  // Main entry point method - Harris County Appraisal District search
  async searchProperty(address) {
    try {
      console.log('Searching Harris County for:', address);
      
      if (!HarrisCountyScraper.isInHarrisCounty(address)) {
        return { error: 'Address does not appear to be in Harris County, Texas' };
      }
      
      await this.delay();
      
      // Use the HCAD Quick Search
      const result = await this.searchHCADQuickSearch(address);
      
      if (result && !result.error) {
        return result;
      } else {
        console.log('Quick search failed, trying alternative methods...');
        // Could add alternative search methods here if needed
        return result; // Return the error from quick search for now
      }
      
    } catch (error) {
      console.error('Harris County search error:', error.message);
      return { error: `Harris County search failed: ${error.message}` };
    }
  }

  // In your harris-county-scraper.js, replace the searchHCADQuickSearch method:

async searchHCADQuickSearch(address) {
  try {
    const searchUrl = 'https://hcad.org/property-search/property-search';
    
    console.log('🔍 Accessing HCAD Property Search...');
    
    // First, get the search page
    await this.delay();
    const response = await this.session.get(searchUrl);
    
    if (response.status !== 200) {
      console.log(`❌ Cannot access HCAD Property Search: ${response.status}`);
      return { error: 'HCAD Property Search page not accessible' };
    }
    
    console.log('✅ Successfully loaded HCAD Property Search page');
    
    const $ = cheerio.load(response.data);
    
    // Look for the main search input field
    const searchInput = $('input[type="text"]').first(); // Usually the main search box
    const searchForm = searchInput.closest('form');
    
    if (!searchForm.length) {
      console.log('❌ Property search form not found');
      return { error: 'Property search form not found on HCAD page' };
    }
    
    console.log('✅ Found property search form');
    
    // Prepare form data
    const formData = new URLSearchParams();
    
    // Add hidden fields from the form
    searchForm.find('input[type="hidden"]').each((i, input) => {
      const name = $(input).attr('name');
      const value = $(input).attr('value');
      if (name && value) {
        formData.append(name, value);
      }
    });
    
    // Add the search address to the main search field
    const searchInputName = searchInput.attr('name') || 'search';
    formData.append(searchInputName, address);
    
    console.log(`🔄 Submitting search for: ${address}`);
    
    // Get form action
    const formAction = searchForm.attr('action') || searchUrl;
    const submitUrl = formAction.startsWith('http') ? formAction : new URL(formAction, searchUrl).href;
    
    // Submit the search
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
    
    // Parse the results - look for the account number and property details
    const $results = cheerio.load(searchResponse.data);
    
    const propertyResults = $results('tr, .property-result, .search-result');
    
    if (propertyResults.length === 0) {
      console.log('❌ No search results found');
      return { error: 'No property results found' };
    }
    
    // Extract data from the results table 
    const data = {
      source: 'Harris County Appraisal District',
      url: submitUrl
    };
    
    // Look for account number 
    const accountText = $results.text();
    const accountMatch = accountText.match(/(\d{10,})/); // Long account numbers
    if (accountMatch) {
      data.accountNumber = accountMatch[1];
      console.log(`✅ Found Account Number: ${data.accountNumber}`);
    }
    
    // Look for owner name 
    const ownerElement = $results('td:contains("Business"), td:contains("Owner")').next();
    if (ownerElement.length) {
      data.owner = ownerElement.text().trim();
    }
    
    // Look for full address
    const addressElement = $results('td').filter((i, el) => {
      return $(el).text().includes('HOUSTON') || $(el).text().includes('TX');
    });
    if (addressElement.length) {
      data.propertyAddress = addressElement.text().trim();
    }
    
    // Try to find a detail link to get more property information
    const detailLink = $results('a[href*="account"], a[href*="detail"], a[href*="property"]').first();
    
    if (detailLink.length) {
      const detailUrl = detailLink.attr('href');
      const fullDetailUrl = detailUrl.startsWith('http') ? detailUrl : new URL(detailUrl, searchUrl).href;
      
      console.log(`🔍 Following property detail link: ${fullDetailUrl}`);
      
      // Get detailed property information
      await this.delay();
      const detailResponse = await this.session.get(fullDetailUrl);
      
      if (detailResponse.status === 200) {
        const detailData = this.parsePropertyDetailPage(detailResponse.data, fullDetailUrl);
        return { ...data, ...detailData };
      }
    }
    
    console.log('✅ Successfully extracted basic property data');
    return data;
    
  } catch (error) {
    console.error('HCAD Property Search error:', error.message);
    return { error: `HCAD Property Search failed: ${error.message}` };
  }
}

  // Single implementation of parseSearchResults that handles both scenarios
  async parseSearchResults(html, baseUrl = 'https://hcad.org') {
    try {
      const $ = cheerio.load(html);
      
      // Check if we got search results
      const resultRows = $('table tr, .search-result, .property-result');
      
      if (resultRows.length === 0) {
        console.log('❌ No search results found');
        return { error: 'No search results found' };
      }
      
      console.log(`✅ Found ${resultRows.length} potential result rows`);
      
      // Look for property detail links
      const propertyLinks = $('a[href*="property"], a[href*="detail"], a[href*="account"]');
      
      if (propertyLinks.length > 0) {
        console.log(`✅ Found ${propertyLinks.length} property links`);
        
        // Get the first property link
        const firstPropertyLink = propertyLinks.first();
        const detailUrl = firstPropertyLink.attr('href');
        
        // Ensure we have a full URL
        const fullDetailUrl = detailUrl.startsWith('http') 
          ? detailUrl 
          : new URL(detailUrl, baseUrl).href;
        
        console.log(`🔍 Following property link: ${fullDetailUrl}`);
        
        // Navigate to the detail page
        await this.delay();
        const detailResponse = await this.session.get(fullDetailUrl);
        
        if (detailResponse.status !== 200) {
          console.log(`❌ Property detail page error: ${detailResponse.status}`);
          return { 
            error: `Property detail page error: ${detailResponse.status}`,
            url: fullDetailUrl
          };
        }
        
        // Extract property data from detail page
        return this.parsePropertyDetailPage(detailResponse.data, fullDetailUrl);
      }
      
      // Fallback: Try to extract data from the search results page
      console.log('⚠️ No property detail links found. Attempting to extract data from search results.');
      
      const data = {
        source: 'Harris County Appraisal District',
        url: baseUrl
      };
      
      // Extract from tables on the current page
      $('table').each((i, table) => {
        const $table = $(table);
        
        // Skip tables that don't look like data tables
        if ($table.find('tr').length < 2) return;
        
        $table.find('tr').each((j, row) => {
          const cells = $(row).find('td, th');
          
          if (cells.length >= 2) {
            const label = $(cells[0]).text().toLowerCase().trim();
            const value = $(cells[1]).text().trim();
            
            this.parseFieldFromLabel(label, value, data);
          }
        });
      });
      
      // Check if we got meaningful data
      const hasData = Object.keys(data).length > 2; // More than just source and url
      
      if (hasData) {
        console.log('✅ Successfully extracted property data from search results');
        return data;
      } else {
        console.log('❌ Unable to extract property data');
        return { 
          error: 'Property found but data extraction not available',
          suggestion: 'HCAD results require manual verification for detailed information',
          url: baseUrl
        };
      }
      
    } catch (error) {
      console.error('Error parsing search results:', error.message);
      return { error: `Results parsing failed: ${error.message}` };
    }
  }

  // Parse the property detail page
  async parsePropertyDetailPage(html, url) {
    try {
      const $ = cheerio.load(html);
      const data = {
        source: 'Harris County Appraisal District',
        url: url
      };
      
      // Extract account number if available
      const accountText = $('body').text();
      const accountMatch = accountText.match(/Account\s*(?:Number|#|No\.?)?\s*[:=]?\s*(\d+)/i);
      if (accountMatch) {
        data.accountNumber = accountMatch[1];
        console.log(`✅ Found Account Number: ${data.accountNumber}`);
      }
      
      // Extract property details from tables
      console.log('🔍 Extracting property details from tables...');
      
      // Look for table headers or titles
      $('h1, h2, h3, h4, h5, h6, caption, th, .table-title, .section-header').each((i, header) => {
        const headerText = $(header).text().trim();
        const table = $(header).next('table');
        
        // If there's no table after this header, skip
        if (table.length === 0) return;
        
        console.log(`   Processing table: "${headerText}"`);
        
        // Check for building info
        if (headerText.match(/building|improvement|structure/i)) {
          table.find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim();
            
            if (label.match(/bedroom|bed\s+count/i)) data.bedrooms = value.replace(/[^\d.]/g, '');
            if (label.match(/bathroom|bath\s+count/i)) data.bathrooms = value.replace(/[^\d.]/g, '');
            if (label.match(/sq\s*ft|area|size/i)) data.livingArea = value.replace(/[^\d.]/g, '');
            if (label.match(/year\s+built/i)) data.yearBuilt = value.replace(/[^\d]/g, '');
            if (label.match(/style|type/i)) data.propertyType = value;
            if (label.match(/stories|floors/i)) data.stories = value.replace(/[^\d.]/g, '');
          });
        }
        
        // Check for valuation/assessment
        if (headerText.match(/value|assessment|appraisal/i)) {
          table.find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim().replace(/[$,]/g, '');
            
            if (label.match(/assessed|total/i)) data.assessedValue = value;
            if (label.match(/land/i)) data.landValue = value;
            if (label.match(/improvement|building/i)) data.improvementValue = value;
            if (label.match(/tax/i)) data.taxAmount = value;
            if (label.match(/market/i)) data.marketValue = value;
          });
        }
        
        // Check for owner information
        if (headerText.match(/owner|ownership/i)) {
          table.find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim();
            
            if (label.match(/name/i)) data.owner = value;
            if (label.match(/mail|mailing/i)) data.mailingAddress = value;
          });
        }
        
        // Check for property location information
        if (headerText.match(/location|address|property/i)) {
          table.find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim();
            
            if (label.match(/address/i)) data.propertyAddress = value;
            if (label.match(/legal|description/i)) data.legalDescription = value;
            if (label.match(/neighborhood/i)) data.neighborhood = value;
            if (label.match(/lot|block/i) && !data.legalDescription) data.legalDescription = value;
          });
        }
      });
      
      // If the above didn't work, try a more generic approach
      if (Object.keys(data).length <= 3) { // Just source, url, and maybe account number
        console.log('⚠️ Table structure not recognized. Trying generic extraction...');
        
        // Extract any property details
        $('table').each((i, table) => {
          $(table).find('tr').each((j, row) => {
            const cells = $(row).find('td');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim();
            
            this.parseFieldFromLabel(label, value, data);
          });
        });
      }
      
      // Extract any data from divs with labeled content
      $('.property-info, .detail-section, .data-section').each((i, section) => {
        const sectionText = $(section).text();
        this.extractDataFromText(sectionText, data);
      });
      
      // Check if we got meaningful data
      const hasData = Object.keys(data).length > 3; // More than just source, url, and account
      
      if (hasData) {
        console.log('✅ Successfully extracted property details');
        return data;
      } else {
        console.log('⚠️ Limited property data extracted');
        return { 
          error: 'Property found but data extraction incomplete',
          partialData: data
        };
      }
      
    } catch (error) {
      console.error('Error parsing property detail page:', error.message);
      return { error: `Detail page parsing failed: ${error.message}` };
    }
  }

  // Helper method to extract data from general text blocks
  extractDataFromText(text, data) {
    const patterns = [
      { regex: /(\d+)\s*bedroom/i, field: 'bedrooms', process: (v) => v },
      { regex: /(\d+(?:\.\d+)?)\s*bath/i, field: 'bathrooms', process: (v) => v },
      { regex: /(\d+(?:,\d+)?)\s*(?:sq\.?\s*ft\.?|square\s*feet)/i, field: 'livingArea', process: (v) => v.replace(/,/g, '') },
      { regex: /built\s*(?:in)?\s*(\d{4})/i, field: 'yearBuilt', process: (v) => v },
      { regex: /assessed\s*value\s*(?:of)?\s*\$?(\d+(?:,\d+)*(?:\.\d+)?)/i, field: 'assessedValue', process: (v) => v.replace(/,/g, '') },
      { regex: /land\s*value\s*(?:of)?\s*\$?(\d+(?:,\d+)*(?:\.\d+)?)/i, field: 'landValue', process: (v) => v.replace(/,/g, '') }
    ];
    
    patterns.forEach(pattern => {
      const match = text.match(pattern.regex);
      if (match && !data[pattern.field]) {
        data[pattern.field] = pattern.process(match[1]);
      }
    });
  }

  // Helper method to standardize field parsing from labels
  parseFieldFromLabel(label, value, data) {
    // Property details
    if (label.match(/bedroom|bed\s+count/i)) data.bedrooms = value.replace(/[^\d.]/g, '');
    if (label.match(/bathroom|bath\s+count/i)) data.bathrooms = value.replace(/[^\d.]/g, '');
    if (label.match(/sq\s*ft|area|size/i)) data.livingArea = value.replace(/[^\d.]/g, '');
    if (label.match(/year\s+built/i)) data.yearBuilt = value.replace(/[^\d]/g, '');
    if (label.match(/style|type/i)) data.propertyType = value;
    
    // Value information
    if (label.match(/assessed|total\s+value/i)) data.assessedValue = value.replace(/[$,]/g, '');
    if (label.match(/land\s+value/i)) data.landValue = value.replace(/[$,]/g, '');
    if (label.match(/improvement|building\s+value/i)) data.improvementValue = value.replace(/[$,]/g, '');
    if (label.match(/market\s+value/i)) data.marketValue = value.replace(/[$,]/g, '');
    if (label.match(/tax\s+amount/i)) data.taxAmount = value.replace(/[$,]/g, '');
    
    // Legal information
    if (label.match(/account\s*(?:number|#|no\.?)/i)) data.accountNumber = value.replace(/[^\d]/g, '');
    if (label.match(/legal\s*description/i)) data.legalDescription = value;
    if (label.match(/owner/i) && !label.includes('address')) data.owner = value;
    if (label.match(/address/i) && !data.propertyAddress) data.propertyAddress = value;
    
    // Other info
    if (label.match(/neighborhood/i)) data.neighborhood = value;
    if (label.match(/block/i)) data.block = value;
    if (label.match(/lot/i)) data.lot = value;
  }

  parseAddress(address) {
    // Parse address into components for HCAD form
    const cleanAddress = address.trim();
    
    // Extract street number (first set of digits)
    const streetNumberMatch = cleanAddress.match(/^\d+/);
    const streetNumber = streetNumberMatch ? streetNumberMatch[0] : '';
    
    // Extract street name (everything after the number, before city)
    let streetName = '';
    if (streetNumber) {
      const afterNumber = cleanAddress.substring(streetNumber.length).trim();
      const commaIndex = afterNumber.indexOf(',');
      streetName = commaIndex > 0 ? afterNumber.substring(0, commaIndex).trim() : afterNumber;
    } else {
      // Handle case where there's no street number
      const commaIndex = cleanAddress.indexOf(',');
      streetName = commaIndex > 0 ? cleanAddress.substring(0, commaIndex).trim() : cleanAddress;
    }

    console.log(`Parsed address: Number=${streetNumber}, Name=${streetName}`);
    
    return {
      streetNumber,
      streetName,
      fullAddress: cleanAddress
    };
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