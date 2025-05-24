// server.js - Using County Data instead of Zillow (Zillow completely removed)
const express = require('express');
const path = require('path');
const axios = require('axios');
const cors = require('cors');
const PDFDocument = require('pdfkit');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Import county scrapers with error handling
let HarrisCountyScraper, FortBendCountyScraper;
let harrisCountyScraper, fortBendCountyScraper;

try {
  HarrisCountyScraper = require('./harris-county-scraper');
  harrisCountyScraper = new HarrisCountyScraper();
} catch (error) {
  console.error('Error loading HarrisCountyScraper:', error.message);  
}

try {
  FortBendCountyScraper = require('./fort-bend-county-scraper');
  fortBendCountyScraper = new FortBendCountyScraper();
} catch (error) {
  console.error('Error loading FortBendCountyScraper:', error.message);
};


// ATTOM API function
async function fetchAttom(address) {
  try {
    const addressParts = address.split(',');
    const address1 = addressParts[0].trim();
    const address2 = addressParts.slice(1).join(',').trim();
    
    console.log('ATTOM API - Address1:', address1, 'Address2:', address2);
    
    const resp = await axios.get(
      'https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail',
      {
        headers: { 
          'apikey': process.env.ATTOM_API_KEY,
          'Accept': 'application/json'
        },
        params: address2 ? { address1, address2 } : { address: address1 }
      }
    );
    
    console.log('ATTOM Response:', resp.status);
    return resp.data?.property?.[0] || resp.data?.property || {};
  } catch (err) {
    console.error('ATTOM Error:', err.response?.status, err.response?.statusText);
    console.error('ATTOM Error Details:', err.response?.data);
    return { error: `ATTOM API Error: ${err.response?.status} ${err.response?.statusText}` };
  }
}

// County Data Fetching Functions
async function fetchCountyData(address) {
  try {
    console.log('🏛️ Fetching county data for:', address);
    
    // Determine which county based on address
    let countyResult = { error: 'Unable to determine county' };
    
    if (HarrisCountyScraper.isInHarrisCounty(address)) {
      console.log('📍 Address appears to be in Harris County');
      countyResult = await harrisCountyScraper.searchProperty(address);
      countyResult.county = 'Harris County';
    } else if (FortBendCountyScraper.isInFortBendCounty(address)) {
      console.log('📍 Address appears to be in Fort Bend County');
      countyResult = await fortBendCountyScraper.searchProperty(address);
      countyResult.county = 'Fort Bend County';
    } else {
      // Try both counties if we can't determine from address
      console.log('📍 County unclear, trying both Harris and Fort Bend');
      
      try {
        countyResult = await harrisCountyScraper.searchProperty(address);
        if (countyResult && !countyResult.error) {
          countyResult.county = 'Harris County';
        }
      } catch (e) {
        console.log('Harris County search failed, trying Fort Bend...');
      }
      
      if (!countyResult || countyResult.error) {
        try {
          countyResult = await fortBendCountyScraper.searchProperty(address);
          if (countyResult && !countyResult.error) {
            countyResult.county = 'Fort Bend County';
          }
        } catch (e) {
          console.log('Fort Bend County search also failed');
        }
      }
    }
    
    if (countyResult && !countyResult.error) {
      console.log('✅ County data retrieved successfully');
      return countyResult;
    } else {
      console.log('❌ County data retrieval failed:', countyResult.error);
      
      return countyResult || { 
        error: 'County data not available',
        suggestion: 'Property report will be generated using ATTOM data only'
      };
    }
    
  } catch (err) {
    console.error('County data fetch error:', err.message);
    return { 
      error: `County data fetch error: ${err.message}`,
      suggestion: 'Check if the county scrapers are properly configured'
    };
  }
}

// Updated property data fetch function - ATTOM + Selected County only
async function fetchPropertyData(address, selectedCounty = null) {
  console.log(`Fetching property data for ${address}, selected county: ${selectedCounty || 'none'}`);
  
  // If selectedCounty is 'none', skip county data fetch
  if (selectedCounty === 'none') {
    console.log('County scraping skipped as per user selection');
    const attom = await fetchAttom(address);
    return { 
      address, 
      sources: { 
        attom, 
        county: { 
          error: 'County data fetch skipped by user',
          skipReason: 'User selected to skip county data'
        } 
      } 
    };
  }
  
  // For specific county selection
  if (selectedCounty) {
    let countyData = { error: 'Selected county scraper not available' };
    
    // Use only the selected county scraper
    if (selectedCounty === 'harris' && harrisCountyScraper) {
      console.log('Using Harris County scraper as selected by user');
      try {
        countyData = await harrisCountyScraper.searchProperty(address);
        countyData.county = 'Harris County';
      } catch (err) {
        countyData = { 
          error: `Harris County scraper error: ${err.message}`,
          county: 'Harris County'
        };
      }
    } else if (selectedCounty === 'fortbend' && fortBendCountyScraper) {
      console.log('Using Fort Bend County scraper as selected by user');
      try {
        countyData = await fortBendCountyScraper.searchProperty(address);
        countyData.county = 'Fort Bend County';
      } catch (err) {
        countyData = { 
          error: `Fort Bend County scraper error: ${err.message}`,
          county: 'Fort Bend County'
        };
      }
    }
    
    const attom = await fetchAttom(address);
    return { address, sources: { attom, county: countyData } };
  }
  
  // Default behavior - try to determine county automatically
  const [attom, county] = await Promise.all([
    fetchAttom(address),
    fetchCountyData(address)
  ]);
  return { address, sources: { attom, county } };
}

// Helper functions for data formatting
function formatMoney(value) {
  if (value == null || value === '' || isNaN(value)) return 'n/a';
  return `$${Number(value).toLocaleString()}`;
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  return isNaN(date.getTime()) ? 'n/a' : date.toLocaleDateString();
}

function getNestedValue(obj, path) {
  if (!path) return null;
  return path.split('.').reduce((current, key) => {
    return current && current[key] !== undefined ? current[key] : null;
  }, obj);
}

// PDF generation function - uses county data + ATTOM
function generatePDFResponse(res, address, sources, currentValues, uploadedImage) {
  const { attom, county } = sources;
  
  console.log('Generating PDF with current values:', currentValues);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="PropertyReport.pdf"');

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);

  // Helper function to get the display value for a field
  function getValue(field, attomPath, countyPath, formatter = v => v) {
    // Use current values if available and not empty
    if (currentValues[field] && currentValues[field] !== 'n/a' && currentValues[field] !== '') {
      console.log(`Using manual value for ${field}: ${currentValues[field]}`);
      return currentValues[field];
    }
    
    // Otherwise use API data - prioritize county data since it's often more current
    const countyVal = countyPath ? getNestedValue(county, countyPath) : null;
    const attomVal = attomPath ? getNestedValue(attom, attomPath) : null;
    
    // Use county data first, then ATTOM as fallback
    const value = countyVal || attomVal;
    const formattedValue = value != null ? formatter(value) : 'n/a';
    
    // Check if the data is from a mock/demo source and log appropriately
    if (value != null) {
      if (countyVal) {
        console.log(`Using county data for ${field}: ${formattedValue}`);
      } else if (attomVal) {
        console.log(`Using ATTOM data for ${field}: ${formattedValue}`);
      }
    } else {
      // Check if county data had an error
      if (county?.error && countyPath) {
        console.log(`County data unavailable for ${field} (${county.error}), using ATTOM or manual entry`);
      } else {
        console.log(`No value found for ${field}, using: n/a`);
      }
    }
    
    return formattedValue;
  }

  // Title
  doc.fontSize(20).text('Property Report', { align: 'center' }).moveDown();
  doc.fontSize(14).text(`Address: ${address}`, { align: 'center' }).moveDown(2);

  // Add data source information at the top
  doc.fontSize(12).fillColor('blue');
  if (county && !county.error) {
    doc.text(`Data Source: ${county.source || county.county || 'County Records'}`, { align: 'center' });
  }
  doc.fillColor('black').moveDown();
  
  // Property Details Section
  doc.fontSize(16).text('Property Details', { underline: true });
  doc.fontSize(12).fillColor('black')
     .text(`Beds: ${getValue('beds', 'building.rooms.beds', 'bedrooms')}`)
     .text(`Baths: ${getValue('baths', 'building.rooms.bathsfull', 'bathrooms')}`)
     .text(`Total Rooms: ${getValue('rooms', 'building.rooms.roomsTotal', 'totalRooms')}`)
     .text(`Living Area: ${getValue('living', 'building.size.livingsize', 'livingArea')} sqft`)
     .text(`Lot Size: ${getValue('lot', 'building.lot.lotsize1', 'lotSize')} sqft`)
     .text(`Year Built: ${getValue('year', 'building.summary.yearBuilt', 'yearBuilt')}`)
     .text(`Construction: ${getValue('construction', 'building.construction.constructiontype', 'constructionType')}`)
     .text(`Property Type: ${getValue('property-type', 'building.summary.propertytype', 'propertyType')}`)
     .text(`Garage: ${getValue('garage', 'building.parking.garagetype', 'garage')}`)
     .text(`Parking Spaces: ${getValue('parking', 'building.parking.prkgSpaces', 'parkingSpaces')}`)
     .moveDown();

  // Financial Information
  doc.fontSize(16).text('Financial Information', { underline: true });
  doc.fontSize(12)
     .text(`Assessed Value: ${getValue('assessed', 'assessment.assessedValue', 'assessedValue', formatMoney)}`)
     .text(`Land Value: ${getValue('land-value', 'assessment.landValue', 'landValue', formatMoney)}`)
     .text(`Improvement Value: ${getValue('improvement-value', 'assessment.improvementValue', 'improvementValue', formatMoney)}`)
     .text(`Tax Amount: ${getValue('tax', 'assessment.taxAmount', 'taxAmount', formatMoney)}`)
     .text(`Last Sale Price: ${getValue('last-sale-price', 'sale.saleAmount', 'lastSoldPrice', formatMoney)}`)
     .text(`Last Sale Date: ${getValue('last-sale-date', 'sale.saleDate', 'lastSoldDate', formatDate)}`)
     .moveDown();

  // School Information (mainly from ATTOM since counties usually don't have this)
  doc.fontSize(16).text('School Information', { underline: true });
  doc.fontSize(12)
     .text(`School District: ${getValue('school-district', 'school.district.schoolDistrictName', null)}`)
     .text(`School Name: ${getValue('school-name', 'school.elementary.0.schoolName', null)}`)
     .text(`School Score: ${getValue('school-score', 'school.elementary.0.testScore', null)}`)
     .moveDown();

  // Risk Information (mainly from ATTOM)
  doc.fontSize(16).text('Risk Assessment', { underline: true });
  doc.fontSize(12)
     .text(`Fire Risk: ${getValue('fire-risk', 'natHazard.fireRisk', null)}`)
     .text(`Wind Risk: ${getValue('wind-risk', 'natHazard.windRisk', null)}`)
     .moveDown();

  // Owner Information
  doc.fontSize(16).text('Owner Information', { underline: true });
  doc.fontSize(12);
  
  // Handle owner name specially - county data is usually more current
  const ownerName = currentValues['owner'] || 
    county?.owner ||
    `${attom?.owner?.owner1?.firstname || ''} ${attom?.owner?.owner1?.lastname || ''}`.trim() || 'n/a';
  
  doc.text(`Owner: ${ownerName}`)
     .text(`Mailing Address: ${getValue('mailing', 'owner.mailingaddressoneline', 'mailingAddress')}`)
     .moveDown();

  // Add data source information
  doc.addPage();
  doc.fontSize(16).text('Data Sources & Status', { underline: true });
  doc.fontSize(12);
  
  if (attom && !attom.error) {
    doc.fillColor('green').text('✓ ATTOM Data: Successfully retrieved');
  } else if (attom?.error) {
    doc.fillColor('red').text(`✗ ATTOM Data: ${attom.error}`);
  }
  
  if (county && !county.error) {
    doc.fillColor('green').text(`✓ County Data: Successfully retrieved from ${county.source || county.county || 'County Records'}`);
  } else if (county?.error) {
    doc.fillColor('red').text(`✗ County Data: ${county.error}`);
    if (county.statusMessage) {
      doc.fillColor('black').fontSize(10).text(`   ${county.statusMessage}`);
    }
    doc.fontSize(12);
  } else {
    doc.fillColor('orange').text('⚠ County Data: Not available for this address');
  }

  // Show which fields were manually edited
  doc.moveDown();
  doc.fillColor('black').fontSize(14).text('Manual Edits:', { underline: true });
  doc.fontSize(11);
  
  const manualEdits = Object.keys(currentValues).filter(key => 
    currentValues[key] && currentValues[key] !== 'n/a' && currentValues[key] !== ''
  );
  
  if (manualEdits.length > 0) {
    manualEdits.forEach(field => {
      doc.text(`• ${field}: ${currentValues[field]}`);
    });
  } else {
    doc.text('None - All values from available API sources');
  }

  // Add note about county data
  if (county?.error) {
    doc.moveDown();
    doc.fontSize(10).fillColor('gray');
    doc.text('Note: County property data was not available during report generation.');
    doc.text('Report uses ATTOM data and any manual entries provided.');
  }
  
  // MOVED TO END: Add property image at the end of the report
  doc.moveDown(2);
  doc.fillColor('black').fontSize(16).text('Property Image', { underline: true });
  doc.moveDown();
  
  if (uploadedImage && uploadedImage.dataUrl) {
    // Use uploaded image if available
    try {
      doc.image(uploadedImage.dataUrl, {
        fit: [400, 300],
        align: 'center'
      });
      doc.fontSize(10).text('User Uploaded Property Image', { align: 'center' });
    } catch (error) {
      console.error('Error adding uploaded image to PDF:', error.message);
      doc.fontSize(10).text('Property image could not be loaded', { align: 'center' });
    }
  } else {
    // Otherwise try to use ATTOM image
    const imageUrl = attom?.property?.photo?.[0]?.url || 
                    attom?.images?.[0]?.url || 
                    attom?.photo?.url;
    
    if (imageUrl) {
      try {
        doc.image(imageUrl, {
          fit: [400, 300],
          align: 'center'
        });
        doc.fontSize(10).text('Property Image from ATTOM', { align: 'center' });
      } catch (error) {
        console.error('Error adding ATTOM image to PDF:', error.message);
        doc.fontSize(10).text('Property image could not be loaded', { align: 'center' });
      }
    } else {
      doc.fontSize(12).text('No property image available', { align: 'center' });
    }
  }

  doc.end();
}

// Test Routes
app.get('/test-attom', async (req, res) => {
  const address = req.query.address || '4529 Winona Court, Denver, CO';
  try {
    const result = await fetchAttom(address);
    res.json({
      api: 'ATTOM',
      address: address,
      success: !result.error,
      data: result
    });
  } catch (err) {
    res.status(500).json({
      api: 'ATTOM',
      address: address,
      success: false,
      error: err.message
    });
  }
});

// Test County Data with better error reporting
app.get('/test-county', async (req, res) => {
  const address = req.query.address || '12345 Main St, Houston, TX';
  try {
    console.log(`\n🧪 Testing county data for: ${address}`);
    const result = await fetchCountyData(address);
    
    // Determine which county was attempted
    let attemptedCounty = 'Unknown';
    if (HarrisCountyScraper.isInHarrisCounty(address)) {
      attemptedCounty = 'Harris County';
    } else if (FortBendCountyScraper.isInFortBendCounty(address)) {
      attemptedCounty = 'Fort Bend County';
    }
    
    // Create detailed response
    const response = {
      api: 'County Data',
      address: address,
      attemptedCounty: attemptedCounty,
      actualCounty: result.county || 'Unknown',
      success: !result.error,
      data: result
    };
    
    // Add status information
    if (result.error) {
      response.statusDetails = {
        error: result.error,
        suggestion: result.suggestion,
        possibleCauses: []
      };
      
      if (result.error.includes('404')) {
        response.statusDetails.possibleCauses.push('County website URLs have changed');
        response.statusDetails.possibleCauses.push('Page structure has been updated');
      } else if (result.error.includes('500')) {
        response.statusDetails.possibleCauses.push('County server experiencing technical difficulties');
        response.statusDetails.possibleCauses.push('Temporary outage or maintenance');
      } else if (result.error.includes('timeout')) {
        response.statusDetails.possibleCauses.push('County website is slow or unresponsive');
        response.statusDetails.possibleCauses.push('Network connectivity issues');
      }
    }
    
    // Add helpful debugging information
    if (result.urlsChecked) {
      response.technicalDetails = {
        urlsAttempted: result.urlsChecked,
        lastError: result.lastError,
        searchAttempted: result.searchAttempted
      };
    }
    
    res.json(response);
  } catch (err) {
    res.status(500).json({
      api: 'County Data',
      address: address,
      success: false,
      error: err.message,
      suggestion: 'Check server logs for more details'
    });
  }
});

// Test both APIs
app.get('/test-both', async (req, res) => {
  const address = req.query.address || '123 Main St, Houston, TX';
  try {
    const { sources } = await fetchPropertyData(address);
    res.json({
      address: address,
      attom: {
        success: !sources.attom.error,
        data: sources.attom
      },
      county: {
        success: !sources.county.error,
        data: sources.county
      }
    });
  } catch (err) {
    res.status(500).json({
      address: address,
      error: err.message
    });
  }
});

// Update the routes to support county selection
app.get('/getPropertyReport', async (req, res) => {
  const address = req.query.address || '';
  const county = req.query.county || null; // Get county from query param
  
  if (!address) {
    return res.status(400).json({ error: 'Address parameter is required' });
  }
  
  try {
    const data = await fetchPropertyData(address, county);
    res.json(data);
  } catch (err) {
    console.error('API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PDF download API - GET version
app.post('/downloadReport', async (req, res) => {
  console.log('POST /downloadReport called');
  
  const { address, currentValues, sources, county, uploadedImage } = req.body;
  
  if (!address) {
    return res.status(400).send('Address parameter is required');
  }
  
  try {
    // Use provided sources if available, otherwise fetch fresh data
    const dataSources = sources || (await fetchPropertyData(address, county)).sources;
    
    // Pass the uploaded image to the PDF generator
    generatePDFResponse(res, address, dataSources, currentValues || {}, uploadedImage);
  } catch (err) {
    console.error('PDF Error:', err);
    res.status(500).send(`PDF generation error: ${err.message}`);
  }
});

app.get('/fetch-county-data', async (req, res) => {
  const address = req.query.address;
  const county = req.query.county;
  
  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }
  
  try {
    let countyData = { error: 'County not supported' };
    
    if (county === 'harris' && harrisCountyScraper) {
      console.log('Fetching Harris County data for:', address);
      countyData = await harrisCountyScraper.searchProperty(address);
      countyData.county = 'Harris County';
    } else if (county === 'fortbend' && fortBendCountyScraper) {
      console.log('Fetching Fort Bend County data for:', address);
      countyData = await fortBendCountyScraper.searchProperty(address);
      countyData.county = 'Fort Bend County';
    }
    
    res.json(countyData);
  } catch (error) {
    console.error(`Error fetching ${county} county data:`, error);
    res.status(500).json({ 
      error: `${county} county data fetch failed: ${error.message}`,
      county: county
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
