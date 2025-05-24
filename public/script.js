// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js';

// Utility functions
function fmtMoney(v) {
  if (v == null || v === '' || isNaN(v)) return 'n/a';
  return `$${Number(v).toLocaleString()}`;
}

function fmtDate(v) {
  if (!v) return 'n/a';
  const d = new Date(v);
  return !isNaN(d.getTime()) ? d.toLocaleDateString() : 'n/a';
}

// PDF rendering variables
let pdfDoc = null,
  pageNum = 1,
  pageRendering = false,
  pageNumPending = null,
  currentPdfBlob = null; // Add this new variable to store the PDF blob
const scale = 1.2;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.getElementById('pdf-preview').appendChild(canvas);

// Store fetched data for real-time updates - ATTOM + County only
let storedData = {
  attom: {},
  county: {}
};

// PDF rendering functions
function renderPage(num) {
  pageRendering = true;
  pdfDoc.getPage(num).then(page => {
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    page.render({ canvasContext: ctx, viewport }).promise.then(() => {
      pageRendering = false;
      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
    });
    document.getElementById('current-page').textContent = num;
  });
}

function queueRenderPage(num) {
  if (pageRendering) pageNumPending = num;
  else renderPage(num);
}

// Event listeners for PDF navigation
document.getElementById('prev-page').addEventListener('click', () => {
  if (pageNum > 1) {
    pageNum--;
    queueRenderPage(pageNum);
    updateNavigationButtons();
  }
});

document.getElementById('next-page').addEventListener('click', () => {
  if (pdfDoc && pageNum < pdfDoc.numPages) {
    pageNum++;
    queueRenderPage(pageNum);
    updateNavigationButtons();
  }
});

function updateNavigationButtons() {
  document.getElementById('prev-page').disabled = pageNum <= 1;
  document.getElementById('next-page').disabled = !pdfDoc || pageNum >= pdfDoc.numPages;
}

// UI helper functions
function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

function setControls(enabled) {
  document.getElementById('download-pdf').classList.toggle('disabled', !enabled);
  updateNavigationButtons();
}

// Get selected data source for a field
function getSelectedSource(field) {
  const select = document.getElementById(`${field}-select`);
  return select ? select.value : 'manual';
}

// Get the appropriate value based on source - ATTOM + County only
function getValueBySource(field, transformFn = v => v) {
  const source = getSelectedSource(field);
  
  if (source === 'attom') {
    return getFieldValue(field, storedData.attom, transformFn);
  } else if (source === 'county') {
    return getFieldValue(field, storedData.county, transformFn);
  }
  
  // For manual, return current input value
  const input = document.getElementById(`${field}-input`);
  return input ? input.value : 'n/a';
}

// Extract field value from API data - updated for county structure
function getFieldValue(field, data, transformFn) {
  let value = 'n/a';
  
  switch (field) {
    case 'beds':
      value = data.building?.rooms?.beds || data.bedrooms;
      break;
    case 'baths':
      value = data.building?.rooms?.bathsfull || data.bathrooms;
      break;
    case 'rooms':
      value = data.building?.rooms?.roomsTotal || data.totalRooms;
      break;
    case 'living':
      value = data.building?.size?.livingsize || data.livingArea;
      break;
    case 'lot':
      value = data.building?.lot?.lotsize1 || data.lotSize;
      break;
    case 'year':
      value = data.building?.summary?.yearBuilt || data.yearBuilt;
      break;
    case 'construction':
      value = data.building?.construction?.constructiontype || data.constructionType;
      break;
    case 'garage':
      value = data.building?.parking?.garagetype || data.garage;
      break;
    case 'parking':
      value = data.building?.parking?.prkgSpaces || data.parkingSpaces;
      break;
    case 'assessed':
      value = data.assessment?.assessedValue || data.assessedValue;
      break;
    case 'land-value':
      value = data.assessment?.landValue || data.landValue;
      break;
    case 'improvement-value':
      value = data.assessment?.improvementValue || data.improvementValue;
      break;
    case 'tax':
      value = data.assessment?.taxAmount || data.taxAmount;
      break;
    case 'last-sale-price':
      value = data.sale?.saleAmount || data.lastSoldPrice;
      break;
    case 'last-sale-date':
      value = data.sale?.saleDate || data.lastSoldDate;
      break;
    case 'school-district':
      value = data.school?.district?.schoolDistrictName || data.schoolDistrict;
      break;
    case 'school-name':
      value = data.school?.elementary?.[0]?.schoolName || data.schoolName;
      break;
    case 'school-score':
      value = data.school?.elementary?.[0]?.testScore || data.schoolScore;
      break;
    case 'fire-risk':
      value = data.natHazard?.fireRisk || data.fireRisk;
      break;
    case 'wind-risk':
      value = data.natHazard?.windRisk || data.windRisk;
      break;
    case 'owner':
      value = `${data.owner?.owner1?.firstname || ''} ${data.owner?.owner1?.lastname || ''}`.trim() || data.owner;
      break;
    case 'mailing':
      value = data.owner?.mailingaddressoneline || data.mailingAddress;
      break;
  }
  
  return value != null ? transformFn(value) : 'n/a';
}

// Populate a field based on selected source - ATTOM + County only
function populateField(field, attomVal, countyVal, transformFn = v => v) {
  const source = getSelectedSource(field);
  const input = document.getElementById(`${field}-input`);
  if (!input) return;
  
  let value = 'n/a';
  if (source === 'attom' && attomVal != null) {
    value = transformFn(attomVal);
  } else if (source === 'county' && countyVal != null) {
    value = transformFn(countyVal);
  }
  // For manual source, don't override existing values
  if (source !== 'manual' || !input.value) {
    input.value = value;
  }
}

// Update field value when dropdown changes
function updateFieldValue(field) {
  const input = document.getElementById(`${field}-input`);
  if (!input) return;
  
  const source = getSelectedSource(field);
  
  // Apply appropriate transform function
  let transformFn = v => v;
  if (['assessed', 'land-value', 'improvement-value', 'tax', 'last-sale-price'].includes(field)) {
    transformFn = fmtMoney;
  } else if (field === 'last-sale-date') {
    transformFn = fmtDate;
  }
  
  if (source === 'attom') {
    input.value = getFieldValue(field, storedData.attom, transformFn);
  } else if (source === 'county') {
    input.value = getFieldValue(field, storedData.county, transformFn);
  }
  // Don't change value for manual selection
}

// Add change listeners to all dropdowns and inputs
function initializeDropdownListeners() {
  const fields = [
    'beds', 'baths', 'rooms', 'living', 'lot', 'year', 'construction',
    'garage', 'parking', 'assessed', 'land-value', 'improvement-value', 'tax', 
    'last-sale-price', 'last-sale-date', 'school-district', 'school-name', 
    'school-score', 'fire-risk', 'wind-risk', 'owner', 'mailing'
  ];
  
  fields.forEach(field => {
    // Dropdown change listener
    const select = document.getElementById(`${field}-select`);
    if (select) {
      select.addEventListener('change', () => {
        updateFieldValue(field);
        // Regenerate PDF with updated values
        if (pdfDoc) {
          generateUpdatedPDF();
        }
      });
    }
    
    // Input field change listener for manual edits
    const input = document.getElementById(`${field}-input`);
    if (input) {
      // Use 'input' event for real-time updates as user types
      input.addEventListener('input', () => {
        // Auto-set dropdown to "manual" when field is edited
        const select = document.getElementById(`${field}-select`);
        if (select) {
          select.value = 'manual';
        }
        
        // Debounce the PDF generation to avoid too many updates while typing
        clearTimeout(input.debounceTimer);
        input.debounceTimer = setTimeout(() => {
          if (pdfDoc) {
            generateUpdatedPDF();
          }
        }, 500); // Wait 500ms after user stops typing
      });
      
      // Also listen for 'change' event (when user loses focus)
      input.addEventListener('change', () => {
        // Auto-set dropdown to "manual" when field is edited
        const select = document.getElementById(`${field}-select`);
        if (select) {
          select.value = 'manual';
        }
        
        if (pdfDoc) {
          generateUpdatedPDF();
        }
      });
    }
  });
}

// Function to clear all fields
function clearAllFields() {
  console.log('Clearing all form fields');
  
  // List of all field IDs to clear
  const fields = [
    'beds', 'baths', 'rooms', 'living', 'lot', 'year', 'construction',
    'garage', 'parking', 'assessed', 'land-value', 'improvement-value', 'tax', 
    'last-sale-price', 'last-sale-date', 'school-district', 'school-name', 
    'school-score', 'fire-risk', 'wind-risk', 'owner', 'mailing'
  ];
  
  // Clear each input field
  fields.forEach(field => {
    const input = document.getElementById(`${field}-input`);
    if (input) {
      input.value = '';
    }
  });
  
  // Remove any property image if present
  const existingContainer = document.querySelector('.property-image-container');
  if (existingContainer) {
    existingContainer.innerHTML = "";
  }
}

// Fetch data from backend based on county selection
async function fetchReportData(address) {
  const countySelect = document.getElementById('county-select');
  const selectedCounty = countySelect ? countySelect.value : 'none';
  
  // Include county selection in the request
  const res = await fetch(`/getPropertyReport?address=${encodeURIComponent(address)}&county=${selectedCounty}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Data fetch failed: ${res.status} - ${errorText}`);
  }
  return res.json();
}

// Fetch PDF from backend
async function fetchPdfBlob(address) {
  const countySelect = document.getElementById('county-select');
  const selectedCounty = countySelect ? countySelect.value : 'none';
  
  const res = await fetch('/downloadReport', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      address: address,
      county: selectedCounty,
      currentValues: {},
      sources: storedData
    })
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PDF fetch failed: ${res.status} - ${errorText}`);
  }
  return res.blob();
}

// Update the download button with the current PDF blob
function updateDownloadButton(address) {
  if (!currentPdfBlob) return;
  
  const downloadBtn = document.getElementById('download-pdf');
  
  // Revoke previous object URL if it exists
  if (downloadBtn.dataset.objectUrl) {
    URL.revokeObjectURL(downloadBtn.dataset.objectUrl);
  }
  
  // Create a new object URL
  const objectUrl = URL.createObjectURL(currentPdfBlob);
  downloadBtn.href = objectUrl;
  downloadBtn.dataset.objectUrl = objectUrl; // Store the URL for later cleanup
  downloadBtn.download = `PropertyReport_${address.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
}

// Generate updated PDF with current field values
async function generateUpdatedPDF() {
  const address = document.getElementById('address-input').value.trim();
  if (!address) return;
  
  console.log('Generating updated PDF...'); 
  
  try {
    // Get current values from all fields
    const currentValues = {};
    const fields = [
      'beds', 'baths', 'rooms', 'living', 'lot', 'year', 'construction',
      'garage', 'parking', 'assessed', 'land-value', 'improvement-value', 'tax', 
      'last-sale-price', 'last-sale-date', 'school-district', 'school-name', 
      'school-score', 'fire-risk', 'wind-risk', 'owner', 'mailing'
    ];
    
    fields.forEach(field => {
      const input = document.getElementById(`${field}-input`);
      if (input) {
        currentValues[field] = input.value;
      }
    });
    
    console.log('Current values:', currentValues); 
    
    // Get county selection
    const countySelect = document.getElementById('county-select');
    const selectedCounty = countySelect ? countySelect.value : 'none';
    
    const requestBody = {
      address: address,
      currentValues: currentValues,
      sources: storedData,
      county: selectedCounty
    };
    
    // Add the uploaded image if available
    if (window.reportData && window.reportData.uploadedImage) {
      requestBody.uploadedImage = window.reportData.uploadedImage;
    }
    
    const response = await fetch('/downloadReport', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`PDF generation failed: ${response.status}`);
    }
    
    const pdfBlob = await response.blob();
    currentPdfBlob = pdfBlob;
    const buffer = await pdfBlob.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
    
    // Make sure it's still on the same page number
    if (pageNum > pdfDoc.numPages) {
      pageNum = 1;
    }
    
    renderPage(pageNum);
    document.getElementById('total-pages').textContent = pdfDoc.numPages;
    
    // Update the download button with the new PDF
    updateDownloadButton(address);
    
    console.log('PDF updated successfully'); 
    
  } catch (error) {
    console.error('PDF regeneration error:', error);
    // Show error to user if status box exists
    const statusBox = document.getElementById('status-box');
    if (statusBox) {
      statusBox.innerHTML = `<span style="color:red;">Error updating PDF: ${error.message}</span>`;
    }
  }
}

// County-specific scraping functions
function fetchHarrisCountyData(address) {
  console.log('Fetching Harris County data for:', address);
  const statusBox = document.getElementById('status-box');
  statusBox.textContent = `Fetching Harris County data for ${address}...`;
  
  // Make an API call to the backend to specifically fetch Harris County data
  return fetch(`/fetch-county-data?address=${encodeURIComponent(address)}&county=harris`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Harris County data fetch failed: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Harris County data received:', data);
      
      // Update the global storedData.county with the results
      storedData.county = data;
      
      // Update status
      if (data.error) {
        statusBox.innerHTML = `<span style="color:orange;">Harris County data: ${data.error}</span>`;
      } else {
        statusBox.innerHTML = `<span style="color:green;">Harris County data successfully retrieved</span>`;
      }
      
      return data;
    })
    .catch(error => {
      console.error('Harris County fetch error:', error);
      statusBox.innerHTML = `<span style="color:red;">Harris County error: ${error.message}</span>`;
      
      // Set error in stored data
      storedData.county = { error: error.message };
      
      return { error: error.message };
    });
}

function fetchFortBendCountyData(address) {
  console.log('Fetching Fort Bend County data for:', address);
  const statusBox = document.getElementById('status-box');
  statusBox.textContent = `Fetching Fort Bend County data for ${address}...`;
  
  // Make an API call to the backend to specifically fetch Fort Bend County data
  return fetch(`/fetch-county-data?address=${encodeURIComponent(address)}&county=fortbend`)
    .then(response => {
      if (!response.ok) {
        throw new Error(`Fort Bend County data fetch failed: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      console.log('Fort Bend County data received:', data);
      
      // Update the global storedData.county with the results
      storedData.county = data;
      
      // Update status
      if (data.error) {
        statusBox.innerHTML = `<span style="color:orange;">Fort Bend County data: ${data.error}</span>`;
      } else {
        statusBox.innerHTML = `<span style="color:green;">Fort Bend County data successfully retrieved</span>`;
      }
      
      return data;
    })
    .catch(error => {
      console.error('Fort Bend County fetch error:', error);
      statusBox.innerHTML = `<span style="color:red;">Fort Bend County error: ${error.message}</span>`;
      
      // Set error in stored data
      storedData.county = { error: error.message };
      
      return { error: error.message };
    });
}

// Main fetch handler - ATTOM + County only
async function handleFetch() {
  const address = document.getElementById('address-input').value.trim();
  if (!address) {
    alert('Please enter an address');
    return;
  }
  
  // Clear all form fields before fetching new data
  clearAllFields();
  
  const statusBox = document.getElementById('status-box');
  showLoading(true);
  setControls(false);
  
  // Get county selection
  const countySelect = document.getElementById('county-select');
  const selectedCounty = countySelect ? countySelect.value : 'none';
  
  statusBox.textContent = `Fetching data for: ${address} (${selectedCounty === 'none' ? 'No County' : selectedCounty})...`;

  // Use county-specific scraper based on selection
  if (selectedCounty === 'harris') {
    fetchHarrisCountyData(address);
  } else if (selectedCounty === 'fortbend') {
    fetchFortBendCountyData(address);
  } else if (selectedCounty === 'none') {
    const statusBox = document.getElementById('status-box');
    if (statusBox) {
      statusBox.innerHTML = '<span style="color:blue;">County scraping skipped. </span>';
    }
  }

  try {
    // Fetch property data
    const { sources } = await fetchReportData(address);
    console.log('Full response:', sources);
    
    // Store data for dropdown updates - ATTOM + County only
    storedData.attom = sources.attom || {};
    storedData.county = sources.county || {};
    
    // Check for errors in the responses
    if (storedData.attom.error) console.warn('ATTOM error:', storedData.attom.error);
    if (storedData.county.error) console.warn('County error:', storedData.county.error);

    // Display property image if available from ATTOM
    setTimeout(() => {
      displayPropertyImage(storedData.attom);
    }, 100);

    // Populate all fields with updated county paths
    populateField('beds', storedData.attom.building?.rooms?.beds, storedData.county.bedrooms);
    populateField('baths', storedData.attom.building?.rooms?.bathsfull, storedData.county.bathrooms);
    populateField('rooms', storedData.attom.building?.rooms?.roomsTotal, storedData.county.totalRooms);
    populateField('living', storedData.attom.building?.size?.livingsize, storedData.county.livingArea);
    populateField('lot', storedData.attom.building?.lot?.lotsize1, storedData.county.lotSize);
    populateField('year', storedData.attom.building?.summary?.yearBuilt, storedData.county.yearBuilt);
    populateField('construction', storedData.attom.building?.construction?.constructiontype, storedData.county.constructionType);
    populateField('garage', storedData.attom.building?.parking?.garagetype, storedData.county.garage);
    populateField('parking', storedData.attom.building?.parking?.prkgSpaces, storedData.county.parkingSpaces);
    populateField('assessed', storedData.attom.assessment?.assessedValue, storedData.county.assessedValue, fmtMoney);
    populateField('land-value', storedData.attom.assessment?.landValue, storedData.county.landValue, fmtMoney);
    populateField('improvement-value', storedData.attom.assessment?.improvementValue, storedData.county.improvementValue, fmtMoney);
    populateField('tax', storedData.attom.assessment?.taxAmount, storedData.county.taxAmount, fmtMoney);
    populateField('last-sale-price', storedData.attom.sale?.saleAmount, storedData.county.lastSoldPrice, fmtMoney);
    populateField('last-sale-date', storedData.attom.sale?.saleDate, storedData.county.lastSoldDate, fmtDate);
    populateField('school-district', storedData.attom.school?.district?.schoolDistrictName, null);
    populateField('school-name', storedData.attom.school?.elementary?.[0]?.schoolName, null);
    populateField('school-score', storedData.attom.school?.elementary?.[0]?.testScore, null);
    populateField('fire-risk', storedData.attom.natHazard?.fireRisk, null);
    populateField('wind-risk', storedData.attom.natHazard?.windRisk, null);
    populateField('owner', 
      `${storedData.attom.owner?.owner1?.firstname || ''} ${storedData.attom.owner?.owner1?.lastname || ''}`.trim(), 
      storedData.county.owner
    );
    populateField('mailing', storedData.attom.owner?.mailingaddressoneline, storedData.county.mailingAddress);
    
    // Ensure image section is populated
    const imageContainer = document.querySelector('.property-image-container');
    if (imageContainer && imageContainer.innerHTML.trim() === '') {
      imageContainer.innerHTML = `
        <div class="image-placeholder">
          <div class="placeholder-text">No property image available</div>
          <label for="image-upload" class="upload-button">Upload Image</label>
          <input type="file" id="image-upload" accept="image/*" hidden>
        </div>
      `;
      
      // Add upload handler
      document.getElementById('image-upload').addEventListener('change', handleImageUpload);
    }

    // Fetch and display PDF
    try {
      const pdfBlob = await fetchPdfBlob(address);
      currentPdfBlob = pdfBlob; // Store the blob for direct download
      const buffer = await pdfBlob.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
      document.getElementById('total-pages').textContent = pdfDoc.numPages;
      pageNum = 1;
      renderPage(pageNum);
      
      // Update the download button with the blob URL
      updateDownloadButton(address);
      
      setControls(true);
      
      // Update status with county information
      let statusMessage = '<span style="color:green;">Data successfully fetched and PDF generated.</span>';
      if (storedData.county && !storedData.county.error) {
        statusMessage += `<br><small>County data from: ${storedData.county.source || storedData.county.county || 'County Records'}</small>`;
      }
      statusBox.innerHTML = statusMessage;
      
    } catch (pdfError) {
      console.error('PDF Error:', pdfError);
      statusBox.innerHTML = `<span style="color:orange;">Data fetched but PDF generation failed: ${pdfError.message}</span>`;
      setControls(false);
    }
    
  } catch (err) {
    console.error('Fetch Error:', err);
    statusBox.innerHTML = `<span style="color:red;">Error: ${err.message}</span>`;
    setControls(false);
  } finally {
    showLoading(false);
  }
}

function displayPropertyImage(attomData) {
  // FIXED: Always look for the container in the generated sections
  let container = document.querySelector('.property-image-container');
  
  // If no container exists, the image section wasn't generated - skip
  if (!container) {
    console.log('Property image container not found - section may not be generated yet');
    return;
  }
  
  // Clear the container
  container.innerHTML = '';
  
  // Check if ATTOM data has an image URL
  const imageUrl = attomData?.property?.photo?.[0]?.url || 
                  attomData?.images?.[0]?.url || 
                  attomData?.photo?.url ||
                  null;
  
  if (imageUrl) {
    // Create the image element
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Property Image';
    img.onerror = function() {
      // If image fails to load, show upload option
      showImageUploadOption(container);
    };
    
    // Create a label
    const label = document.createElement('div');
    label.className = 'property-image-label';
    label.textContent = 'Property Image from ATTOM';
    
    // Add image controls
    const controls = document.createElement('div');
    controls.className = 'image-controls';
    
    // Replace button
    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = 'Replace Image';
    replaceBtn.onclick = function() {
      showImageUploadOption(container);
    };
    
    controls.appendChild(replaceBtn);
    
    // Add elements to container
    container.appendChild(img);
    container.appendChild(label);
    container.appendChild(controls);
  } else {
    // Show upload option if no image available
    showImageUploadOption(container);
  }
}

// Cleanup function to be called when page unloads
function cleanupObjectURLs() {
  const downloadBtn = document.getElementById('download-pdf');
  if (downloadBtn && downloadBtn.dataset.objectUrl) {
    URL.revokeObjectURL(downloadBtn.dataset.objectUrl);
  }
}

// Field generation system
// Define field groups with their fields
const fieldGroups = [
  {
    title: "Property Details",
    fields: [
      { id: "beds", label: "Beds", placeholder: "Beds" },
      { id: "baths", label: "Baths", placeholder: "Baths" },
      { id: "rooms", label: "Total Rooms", placeholder: "Rooms" },
      { id: "year", label: "Year Built", placeholder: "Year Built" },
      { id: "living", label: "Living Area (sqft)", placeholder: "Living Area" },
      { id: "lot", label: "Lot Size (sqft)", placeholder: "Lot Size" },
      { id: "construction", label: "Construction Type", placeholder: "Construction Type" },
      { id: "garage", label: "Garage", placeholder: "Garage" },
      { id: "parking", label: "Parking Spaces", placeholder: "Parking Spaces" }
    ]
  },
  {
    title: "Financial Information",
    fields: [
      { id: "assessed", label: "Assessed Value", placeholder: "Assessed Value" },
      { id: "land-value", label: "Land Value", placeholder: "Land Value" },
      { id: "improvement-value", label: "Improvement Value", placeholder: "Improvement Value" },
      { id: "tax", label: "Tax Amount", placeholder: "Tax Amount" },
      { id: "last-sale-price", label: "Last Sale Price", placeholder: "Last Sale Price" },
      { id: "last-sale-date", label: "Last Sale Date", placeholder: "Last Sale Date" }
    ]
  },
  {
    title: "School Information",
    fields: [
      { id: "school-district", label: "School District", placeholder: "School District" },
      { id: "school-name", label: "School Name", placeholder: "School Name" },
      { id: "school-score", label: "School Score", placeholder: "School Score" }
    ]
  },
  {
    title: "Risk Assessment",
    fields: [
      { id: "fire-risk", label: "Fire Risk", placeholder: "Fire Risk" },
      { id: "wind-risk", label: "Wind Risk", placeholder: "Wind Risk" }
    ]
  },
  {
    title: "Owner Information",
    fields: [
      { id: "owner", label: "Owner", placeholder: "Owner" },
      { id: "mailing", label: "Mailing Address", placeholder: "Mailing Address" }
    ]
  },
  {
    title: "Property Image",
    type: "image", // Special type for image section
    fields: [] // No regular fields for image section
  }
];

// Helper function to generate the fields HTML
function generateFields(fields) {
  let html = '';
  
  // Group fields in pairs for a 2-column layout
  for (let i = 0; i < fields.length; i += 2) {
    html += '<div class="field-grid">';
    
    // Add the first field
    html += createField(fields[i]);
    
    // Add the second field if it exists
    if (i + 1 < fields.length) {
      html += createField(fields[i + 1]);
    }
    
    html += '</div>';
  }
  
  return html;
}

// Create HTML for a single field
function createField(field) {
  return `
    <div class="field-row">
      <label>${field.label}</label>
      <div class="input-source-group">
        <input id="${field.id}-input" type="text" placeholder="${field.placeholder}" class="field-input" />
        <select id="${field.id}-select" class="source-select">
          <option value="attom">ATTOM</option>
          <option value="county">County</option>
          <option value="manual">Manual</option>
        </select>
      </div>
    </div>
  `;
}

// Wait for DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', function() {
  // Generate form fields from the configuration
  const selectorsContainer = document.querySelector('.selectors');
  
  // Only generate if the container exists and haven't already generated the fields
  if (selectorsContainer && !window.fieldsGenerated) {
    // Clear existing content
    selectorsContainer.innerHTML = ''; 
    
    // Generate each section
    fieldGroups.forEach(group => {
      // Create section element
      const section = document.createElement('div');
      section.className = 'collapsible-section';

      if (group.type === 'image') {
        section.innerHTML = `
          <h3 class="section-header">
            <button class="collapse-toggle" aria-expanded="true">
              <span class="toggle-icon">▼</span>
              ${group.title}
            </button>
          </h3>
          <div class="section-content">
            <div id="property-image-container" class="property-image-container">
              <div class="image-placeholder">
                <div class="placeholder-text">No property image available</div>
                <label for="image-upload" class="upload-button">Upload Image</label>
                <input type="file" id="image-upload" accept="image/*" hidden>
              </div>
            </div>
          </div>
        `;
        } else {
          // Regular field sections
          section.innerHTML = `
            <h3 class="section-header">
              <button class="collapse-toggle" aria-expanded="true">
                <span class="toggle-icon">▼</span>
                ${group.title}
              </button>
            </h3>
            <div class="section-content">
              <div class="field-container">
                ${generateFields(group.fields)}
              </div>
            </div>
          `;
        }

      selectorsContainer.appendChild(section);
    });
    
    // Mark that the fields are generated
    window.fieldsGenerated = true;
  }

  // Event listeners
  document.getElementById('fetch-btn').addEventListener('click', handleFetch);
  document.getElementById('address-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleFetch();
  });

  // Initialize dropdown listeners and controls
  initializeDropdownListeners();
  setControls(false);
  
  // Add cleanup for object URLs when page unloads
  window.addEventListener('beforeunload', cleanupObjectURLs);
  
  // Collapsible Section Functionality
  const toggleButtons = document.querySelectorAll('.collapse-toggle');
  
  // Add click event listener to each toggle button
  toggleButtons.forEach(button => {
    button.addEventListener('click', function() {
      // Toggle aria-expanded attribute
      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', !isExpanded);
      
      // Toggle collapsed class on the content section
      const content = button.closest('.collapsible-section').querySelector('.section-content');
      if (isExpanded) {
        content.classList.add('collapsed');
      } else {
        content.classList.remove('collapsed');
      }
    });
  });

  // Function to collapse all sections
  function collapseAllSections() {
    toggleButtons.forEach(button => {
      button.setAttribute('aria-expanded', 'false');
      const content = button.closest('.collapsible-section').querySelector('.section-content');
      content.classList.add('collapsed');
    });
  }
  
  // Function to expand all sections
  function expandAllSections() {
    toggleButtons.forEach(button => {
      button.setAttribute('aria-expanded', 'true');
      const content = button.closest('.collapsible-section').querySelector('.section-content');
      content.classList.remove('collapsed');
    });
  }
  
  // Add event listeners for collapse/expand all buttons
  const collapseAllBtn = document.getElementById('collapse-all-btn');
  const expandAllBtn = document.getElementById('expand-all-btn');
  
  if (collapseAllBtn) {
    collapseAllBtn.addEventListener('click', collapseAllSections);
  }
  
  if (expandAllBtn) {
    expandAllBtn.addEventListener('click', expandAllSections);
  }

  // AUTO-SELECT "MANUAL" WHEN FIELD IS EDITED - second implementation
  // This is in addition to the listeners in initializeDropdownListeners
  // Get all input fields
  const fieldInputs = document.querySelectorAll('.field-input');
  
  fieldInputs.forEach(input => {
    // For each input field, add an input event listener
    input.addEventListener('input', function() {
      // Find the associated select element (it's in the same parent div)
      const parentGroup = this.closest('.input-source-group');
      if (parentGroup) {
        const selectElement = parentGroup.querySelector('.source-select');
        if (selectElement) {
          // Set the select to "manual" as the user is manually editing
          selectElement.value = "manual";
        }
      }
    });
  });
});

// Function to handle image upload with property report sizing
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  // Check if it's an image
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file (JPG, PNG, GIF, etc.)');
    return;
  }
  
  // Check file size (limit to 10MB)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    alert('Image file is too large. Please select an image smaller than 10MB.');
    return;
  }
  
  // Get container
  const container = document.querySelector('.property-image-container');
  if (!container) return;
  
  // Show loading state
  container.innerHTML = `
    <div class="image-loading">
      <div class="loading-spinner"></div>
      <div class="loading-text">Processing image...</div>
    </div>
  `;
  
  // Create FileReader to process the image
  const reader = new FileReader();
  reader.onload = function(e) {
    // Create an image element to get dimensions and resize
    const img = new Image();
    img.onload = function() {
      // Create canvas for resizing to property report standards
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Property report standard dimensions (4:3 aspect ratio, max 800x600)
      const maxWidth = 800;
      const maxHeight = 600;
      let { width, height } = img;
      
      // Calculate new dimensions maintaining aspect ratio
      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height;
          height = maxHeight;
        }
      }
      
      // Set canvas dimensions
      canvas.width = width;
      canvas.height = height;
      
      // Draw and resize image
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to optimized format (JPEG with 85% quality for smaller file size)
      const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      // Display the processed image
      displayUploadedImage(optimizedDataUrl, file.name, width, height, file.size);
      
      // Store the optimized image data
      const imgData = {
        name: file.name,
        type: 'image/jpeg', // Always convert to JPEG for consistency
        dataUrl: optimizedDataUrl,
        originalSize: file.size,
        optimizedSize: Math.round(optimizedDataUrl.length * 0.75), // Rough size estimate
        dimensions: `${width}x${height}`
      };
      
      // Store in global data
      if (!window.reportData) window.reportData = {};
      window.reportData.uploadedImage = imgData;
      
      console.log('Image processed and stored:', {
        original: `${file.name} (${(file.size/1024).toFixed(1)}KB)`,
        processed: `${width}x${height} (${(imgData.optimizedSize/1024).toFixed(1)}KB)`
      });
      
      // Update PDF if one exists
      if (pdfDoc) {
        generateUpdatedPDF();
      }
    };
    
    img.onerror = function() {
      container.innerHTML = `
        <div class="image-error">
          <div class="error-icon">⚠️</div>
          <div class="error-text">Failed to process image. Please try a different image.</div>
          <button onclick="showImageUploadOption(document.querySelector('.property-image-container'))" class="retry-button">Try Again</button>
        </div>
      `;
    };
    
    img.src = e.target.result;
  };
  
  reader.onerror = function() {
    container.innerHTML = `
      <div class="image-error">
        <div class="error-icon">⚠️</div>
        <div class="error-text">Failed to read image file. Please try again.</div>
        <button onclick="showImageUploadOption(document.querySelector('.property-image-container'))" class="retry-button">Try Again</button>
      </div>
    `;
  };
  
  reader.readAsDataURL(file);
}

// Function to display the uploaded and processed image
function displayUploadedImage(dataUrl, fileName, width, height, originalSize) {
  const container = document.querySelector('.property-image-container');
  if (!container) return;
  
  container.innerHTML = `
    <div class="uploaded-image-display">
      <img src="${dataUrl}" alt="Property Image" class="property-image">
      <div class="image-info">
        <div class="image-label">📸 Uploaded Property Image</div>
        <div class="image-details">
          <span class="file-name">${fileName}</span>
          <span class="image-specs">${width}×${height} • ${(originalSize/1024).toFixed(1)}KB</span>
        </div>
      </div>
      <div class="image-controls">
        <button onclick="replaceImage()" class="replace-btn">Replace Image</button>
        <button onclick="removeImage()" class="remove-btn">Remove</button>
      </div>
    </div>
  `;
}

// Function to replace the current image
function replaceImage() {
  showImageUploadOption(document.querySelector('.property-image-container'));
}

// Function to remove the uploaded image
function removeImage() {
  // Clear stored image data
  if (window.reportData && window.reportData.uploadedImage) {
    delete window.reportData.uploadedImage;
  }
  
  // Show upload option again
  showImageUploadOption(document.querySelector('.property-image-container'));
  
  // Update PDF if one exists
  if (pdfDoc) {
    generateUpdatedPDF();
  }
}

function showImageUploadOption(container) {
  // Create unique ID for this instance
  const uploadId = 'image-upload-' + Date.now();
  
  container.innerHTML = `
    <div class="image-placeholder">
      <div class="placeholder-text">No property image available</div>
      <label for="image-upload" class="upload-button">Upload Image</label>
      <input type="file" id="image-upload" accept="image/*" hidden>
    </div>
  `;
  
  // Add the event listener to the new input
  const fileInput = document.getElementById(uploadId);
  fileInput.addEventListener('change', handleImageUpload);
  
  // Add drag and drop functionality
  const uploadArea = container.querySelector('.upload-area');
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  
  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Simulate file input change event
      fileInput.files = files;
      handleImageUpload({ target: { files: files } });
    }
  });
}