const axios = require('axios');
const cheerio = require('cheerio');

class FortBendCountyScraper {
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

  // Main entry point method - Fort Bend County Appraisal District search
  async searchProperty(address) {
    try {
      console.log('Searching Fort Bend County for:', address);
      
      if (!FortBendCountyScraper.isInFortBendCounty(address)) {
        return { error: 'Address does not appear to be in Fort Bend County, Texas' };
      }
      
      await this.delay();
      
      // Search using the FBCAD search page
      const result = await this.searchFBCAD(address);
      
      if (result && !result.error) {
        return result;
      } else {
        console.log('FBCAD search failed, trying alternative methods...');
        // Could add alternative search methods here if needed
        return result; // Return the error from quick search for now
      }
      
    } catch (error) {
      console.error('Fort Bend County search error:', error.message);
      return { error: `Fort Bend County search failed: ${error.message}` };
    }
  }

  async searchFBCAD(searchQuery) {
    try {
      // The base search URL for FBCAD
      const searchUrl = 'https://esearch.fbcad.org/Search/Result';
      
      console.log('🔍 Accessing FBCAD search...');
      
      // Make the search request
      await this.delay();
      const response = await this.session.get(`${searchUrl}?keywords=${encodeURIComponent(searchQuery)}`);
      
      if (response.status !== 200) {
        console.log(`❌ Cannot access FBCAD search: ${response.status}`);
        return { error: 'FBCAD search page not accessible' };
      }
      
      console.log('✅ Successfully loaded FBCAD search results');
      
      // Parse search results to find property links
      const $ = cheerio.load(response.data);
      
      // Look for property result items
      const propertyResults = $('.search-results-property, .property-card, .search-result-item');
      
      if (propertyResults.length === 0) {
        console.log('❌ No property results found');
        
        // Check if there's an error message
        const errorMsg = $('.alert-danger, .error-message').text().trim();
        if (errorMsg) {
          return { error: `FBCAD search error: ${errorMsg}` };
        }
        
        return { error: 'No property results found' };
      }
      
      console.log(`✅ Found ${propertyResults.length} potential property results`);
      
      // Get the first property link
      const propertyLink = propertyResults.first().find('a[href*="Property/"], a[href*="Detail/"]').first();
      
      if (!propertyLink.length) {
        console.log('❌ No property detail links found in search results');
        
        // Try to extract some basic info from the search results
        return this.extractFromSearchResults($, propertyResults.first());
      }
      
      const detailUrl = propertyLink.attr('href');
      const fullDetailUrl = detailUrl.startsWith('http') ? detailUrl : new URL(detailUrl, 'https://esearch.fbcad.org').href;
      
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
      
      // Parse the property detail page
      return this.parsePropertyDetailPage(detailResponse.data, fullDetailUrl);
      
    } catch (error) {
      console.error('FBCAD search error:', error.message);
      return { error: `FBCAD search failed: ${error.message}` };
    }
  }

  // Extract basic info from search results if we can't get to the detail page
  extractFromSearchResults($, resultElement) {
    try {
      const data = {
        source: 'Fort Bend County Appraisal District',
        partialData: true
      };
      
      // Try to extract account number
      const accountText = resultElement.text();
      const accountMatch = accountText.match(/Account #:?\s*(\d+)/i) || accountText.match(/Property ID:?\s*(\d+)/i);
      if (accountMatch) {
        data.accountNumber = accountMatch[1];
      }
      
      // Try to extract address
      const addressElement = resultElement.find('.address, .property-address, [data-label="Address"]');
      if (addressElement.length) {
        data.propertyAddress = addressElement.text().trim();
      }
      
      // Try to extract owner name
      const ownerElement = resultElement.find('.owner, .owner-name, [data-label="Owner"]');
      if (ownerElement.length) {
        data.owner = ownerElement.text().trim();
      }
      
      return data;
    } catch (error) {
      console.error('Error extracting from search results:', error.message);
      return { error: 'Failed to extract data from search results' };
    }
  }

  // Parse the property detail page
  async parsePropertyDetailPage(html, url) {
    try {
      const $ = cheerio.load(html);
      
      const data = {
        source: 'Fort Bend County Appraisal District',
        url: url
      };
      
      // Extract account number if available
      const accountText = $('body').text();
      const accountMatch = accountText.match(/Account #:?\s*(\d+)/i) || 
                         accountText.match(/Property ID:?\s*(\d+)/i) ||
                         accountText.match(/R\d{5,}/i);
      if (accountMatch) {
        data.accountNumber = accountMatch[0].replace(/[^\d]/g, '');
        console.log(`✅ Found Account Number: ${data.accountNumber}`);
      }
      
      // Extract property details from sections and tables
      console.log('🔍 Extracting property details...');
      
      // Function to clean extracted text
      const cleanText = (text) => text.replace(/\s+/g, ' ').trim();
      
      // Extract from property sections
      this.extractFromPropertySections($, data);
      
      // Extract from tables
      this.extractFromTables($, data);
      
      // Extract from labeled fields
      this.extractFromLabeledFields($, data);
      
      // Extract owner information
      this.extractOwnerInfo($, data);
      
      // Extract value information
      this.extractValueInfo($, data);
      
      // Add some additional formatting for certain fields
      if (data.bedrooms) data.bedrooms = data.bedrooms.replace(/[^\d.]/g, '');
      if (data.bathrooms) data.bathrooms = data.bathrooms.replace(/[^\d.]/g, '');
      if (data.livingArea) data.livingArea = data.livingArea.replace(/[^\d.]/g, '');
      if (data.lotSize) data.lotSize = data.lotSize.replace(/[^\d.]/g, '');
      if (data.yearBuilt) data.yearBuilt = data.yearBuilt.replace(/[^\d]/g, '');
      
      if (data.assessedValue) data.assessedValue = data.assessedValue.replace(/[$,]/g, '');
      if (data.landValue) data.landValue = data.landValue.replace(/[$,]/g, '');
      if (data.improvementValue) data.improvementValue = data.improvementValue.replace(/[$,]/g, '');
      
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

  // Extract from property information sections
  extractFromPropertySections($, data) {
    // Look for sections with headers
    $('.card, .panel, .section, .property-section').each((i, section) => {
      const $section = $(section);
      const headerText = $section.find('.card-header, .panel-heading, .section-header, h2, h3, h4').text().trim().toLowerCase();
      
      if (headerText.includes('building') || headerText.includes('improvement') || headerText.includes('structure')) {
        // Extract building info
        $section.find('tr, .row, .detail-row').each((j, row) => {
          const $row = $(row);
          const label = $row.find('th, .label, .detail-label').text().trim().toLowerCase();
          const value = $row.find('td, .value, .detail-value').text().trim();
          
          if (label.includes('bed')) data.bedrooms = value;
          if (label.includes('bath')) data.bathrooms = value;
          if (label.match(/living area|sq\s*ft|square feet/)) data.livingArea = value;
          if (label.includes('year built')) data.yearBuilt = value;
          if (label.match(/stories|floor/)) data.stories = value;
          if (label.includes('quality')) data.quality = value;
          if (label.includes('condition')) data.condition = value;
          if (label.includes('style') || label.includes('type')) data.propertyType = value;
        });
      } else if (headerText.includes('land') || headerText.includes('lot')) {
        // Extract land info
        $section.find('tr, .row, .detail-row').each((j, row) => {
          const $row = $(row);
          const label = $row.find('th, .label, .detail-label').text().trim().toLowerCase();
          const value = $row.find('td, .value, .detail-value').text().trim();
          
          if (label.match(/area|sq\s*ft|acreage|square feet|lot size/)) data.lotSize = value;
          if (label.includes('type')) data.lotType = value;
          if (label.includes('dimension')) data.lotDimensions = value;
        });
      } else if (headerText.includes('value') || headerText.includes('assessment')) {
        // Extract value info
        $section.find('tr, .row, .detail-row').each((j, row) => {
          const $row = $(row);
          const label = $row.find('th, .label, .detail-label').text().trim().toLowerCase();
          const value = $row.find('td, .value, .detail-value').text().trim();
          
          if (label.match(/total|assessed/)) data.assessedValue = value;
          if (label.includes('land value')) data.landValue = value;
          if (label.match(/improvement|building/)) data.improvementValue = value;
          if (label.includes('tax') && label.includes('amount')) data.taxAmount = value;
          if (label.includes('market')) data.marketValue = value;
        });
      }
    });
  }

  // Extract from tables
  extractFromTables($, data) {
    $('table').each((i, table) => {
      const $table = $(table);
      const caption = $table.find('caption').text().trim().toLowerCase();
      
      // Skip tables that don't look like data tables
      if ($table.find('tr').length < 2) return;
      
      $table.find('tr').each((j, row) => {
        const $row = $(row);
        const cells = $row.find('td, th');
        
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim().toLowerCase();
          const value = $(cells[1]).text().trim();
          
          // Property details
          if (label.includes('bedroom')) data.bedrooms = value;
          if (label.includes('bathroom')) data.bathrooms = value;
          if (label.match(/living area|sq\s*ft|square feet/)) data.livingArea = value;
          if (label.includes('year built')) data.yearBuilt = value;
          if (label.match(/lot size|land area/)) data.lotSize = value;
          
          // Value information
          if (label.match(/total value|assessed/)) data.assessedValue = value;
          if (label.includes('land value')) data.landValue = value;
          if (label.match(/improvement|building value/)) data.improvementValue = value;
          
          // Owner information
          if (label.includes('owner name')) data.owner = value;
          if (label.includes('mailing address')) data.mailingAddress = value;
        }
      });
    });
  }

  // Extract from labeled fields
  extractFromLabeledFields($, data) {
    // Look for label + value pairs
    $('.detail-row, .property-field, .field-group').each((i, field) => {
      const $field = $(field);
      const label = $field.find('.detail-label, .field-label, .label').text().trim().toLowerCase();
      const value = $field.find('.detail-value, .field-value, .value').text().trim();
      
      if (!label || !value) return;
      
      // Property details
      if (label.includes('bedroom')) data.bedrooms = value;
      if (label.includes('bathroom')) data.bathrooms = value;
      if (label.match(/living area|sq\s*ft|square feet/)) data.livingArea = value;
      if (label.includes('year built')) data.yearBuilt = value;
      if (label.match(/lot size|land area/)) data.lotSize = value;
      
      // Value information
      if (label.match(/total value|assessed/)) data.assessedValue = value;
      if (label.includes('land value')) data.landValue = value;
      if (label.match(/improvement|building value/)) data.improvementValue = value;
      
      // Owner information
      if (label.includes('owner name')) data.owner = value;
      if (label.includes('mailing address')) data.mailingAddress = value;
    });
  }

  // Extract owner information
  extractOwnerInfo($, data) {
    // Look for owner section
    const ownerSection = $('.owner-info, .owner-section, section:contains("Owner")');
    if (ownerSection.length) {
      const ownerText = ownerSection.text();
      
      // Extract owner name
      const ownerNameMatch = ownerText.match(/Owner(?:\s*Name)?:?\s*([^,\n]+)/i);
      if (ownerNameMatch) {
        data.owner = ownerNameMatch[1].trim();
      }
      
      // Extract mailing address
      const mailingAddressMatch = ownerText.match(/Mailing\s*Address:?\s*([^\n]+)/i);
      if (mailingAddressMatch) {
        data.mailingAddress = mailingAddressMatch[1].trim();
      }
    }
    
    // If still not found, try more general search
    if (!data.owner) {
      // Look for elements containing "Owner" text
      $('*:contains("Owner")').each((i, el) => {
        const $el = $(el);
        const elText = $el.text().trim();
        
        // Skip elements with too much text
        if (elText.length > 200) return;
        
        const ownerMatch = elText.match(/Owner(?:\s*Name)?:?\s*([^,\n]+)/i);
        if (ownerMatch) {
          data.owner = ownerMatch[1].trim();
        }
      });
    }
  }

  // Extract value information
  extractValueInfo($, data) {
    // Look for value section
    const valueSection = $('.value-info, .assessment-section, section:contains("Value")');
    if (valueSection.length) {
      const valueText = valueSection.text();
      
      // Extract various values
      const assessedMatch = valueText.match(/(?:Total|Assessed)\s*Value:?\s*\$?([0-9,]+)/i);
      if (assessedMatch) {
        data.assessedValue = assessedMatch[1].trim();
      }
      
      const landMatch = valueText.match(/Land\s*Value:?\s*\$?([0-9,]+)/i);
      if (landMatch) {
        data.landValue = landMatch[1].trim();
      }
      
      const improvementMatch = valueText.match(/(?:Improvement|Building)\s*Value:?\s*\$?([0-9,]+)/i);
      if (improvementMatch) {
        data.improvementValue = improvementMatch[1].trim();
      }
    }
    
    // If still not found, look for tables with value information
    if (!data.assessedValue) {
      $('table, .table').each((i, table) => {
        const $table = $(table);
        const tableText = $table.text().toLowerCase();
        
        if (tableText.includes('value') || tableText.includes('assessed') || tableText.includes('appraisal')) {
          $table.find('tr').each((j, row) => {
            const cells = $(row).find('td, th');
            if (cells.length < 2) return;
            
            const label = $(cells[0]).text().trim().toLowerCase();
            const value = $(cells[1]).text().trim();
            
            if (label.match(/total|assessed/i)) data.assessedValue = value.replace(/[^0-9,]/g, '');
            if (label.includes('land')) data.landValue = value.replace(/[^0-9,]/g, '');
            if (label.match(/improvement|building/)) data.improvementValue = value.replace(/[^0-9,]/g, '');
          });
        }
      });
    }
  }

  // Method to check if address is in Fort Bend County
  static isInFortBendCounty(address) {
    const fortBendCities = [
      'sugar land', 'missouri city', 'rosenberg', 'richmond', 'stafford', 
      'katy', 'fulshear', 'needville', 'meadows place', 'arcola', 
      'thompson', 'fresno', 'sienna', 'cinco ranch', 'fort bend',
      'pearland'
    ];
    
    const lowerAddress = address.toLowerCase();
    return fortBendCities.some(city => lowerAddress.includes(city)) || 
           lowerAddress.includes('fort bend') || 
           // Fort Bend ZIP codes
           /774\d{2}/.test(address) ||
           /775\d{2}/.test(address) ||
           lowerAddress.includes('ft bend') ||
           lowerAddress.includes('tx');
  }
}

module.exports = FortBendCountyScraper;