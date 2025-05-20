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
  
  const res = await fetch(`/downloadReport?address=${encodeURIComponent(address)}&county=${selectedCounty}`);
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
  
  console.log('Generating updated PDF...'); // Debug log
  
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
    
    console.log('Current values:', currentValues); // Debug log
    
    // Send to backend with current values
    const countySelect = document.getElementById('county-select');
    const selectedCounty = countySelect ? countySelect.value : 'none';
    
    const response = await fetch('/downloadReport', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: address,
        currentValues: currentValues,
        sources: storedData,
        county: selectedCounty
      })
    });
    
    if (!response.ok) {
      throw new Error(`PDF generation failed: ${response.status}`);
    }
    
    const pdfBlob = await response.blob();
    currentPdfBlob = pdfBlob; // Store the blob for direct download
    const buffer = await pdfBlob.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
    
    // Make sure we're still on the same page number
    if (pageNum > pdfDoc.numPages) {
      pageNum = 1;
    }
    
    renderPage(pageNum);
    document.getElementById('total-pages').textContent = pdfDoc.numPages;
    
    // Update the download button with the new PDF
    updateDownloadButton(address);
    
    console.log('PDF updated successfully'); // Debug log
    
  } catch (error) {
    console.error('PDF regeneration error:', error);
    // Show error to user
    const statusBox = document.getElementById('status-box');
    statusBox.innerHTML = `<span style="color:red;">Error updating PDF: ${error.message}</span>`;
  }
}

// County-specific scraping functions
function fetchHarrisCountyData(address) {
  console.log('Fetching Harris County data for:', address);
  const statusBox = document.getElementById('status-box');
  statusBox.textContent = `Fetching Harris County data for ${address}...`;
  
  // Call your existing Harris County scraping code here
  // This function should update storedData.county with results
}

function fetchFortBendCountyData(address) {
  console.log('Fetching Fort Bend County data for:', address);
  const statusBox = document.getElementById('status-box');
  statusBox.textContent = `Fetching Fort Bend County data for ${address}...`;
  
  // Call your existing Fort Bend County scraping code here
  // This function should update storedData.county with results
}

// Main fetch handler - ATTOM + County only
async function handleFetch() {
  const address = document.getElementById('address-input').value.trim();
  if (!address) {
    alert('Please enter an address');
    return;
  }
  
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
    // Skip county scraping
    statusBox.textContent = `County scraping skipped. Using ATTOM data only.`;
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
    displayPropertyImage(storedData.attom);

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

// Display property image from ATTOM data if available
function displayPropertyImage(attomData) {
  // Remove any existing property image container
  const existingContainer = document.getElementById('property-image-container');
  if (existingContainer) {
    existingContainer.remove();
  }
  
  // Check if ATTOM data has an image URL
  const imageUrl = attomData?.property?.photo?.[0]?.url || 
                  attomData?.images?.[0]?.url || 
                  attomData?.photo?.url ||
                  null;
  
  if (imageUrl) {
    // Create a container for the property image
    const container = document.createElement('div');
    container.id = 'property-image-container';
    container.className = 'property-image-container';
    
    // Create the image element
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = 'Property Image';
    img.onerror = function() {
      // If image fails to load, show a message
      this.style.display = 'none';
      const errorMsg = document.createElement('div');
      errorMsg.textContent = 'Property image unavailable';
      errorMsg.style.padding = '20px';
      errorMsg.style.backgroundColor = '#f8f9fa';
      errorMsg.style.borderRadius = '4px';
      container.appendChild(errorMsg);
    };
    
    // Create a label
    const label = document.createElement('div');
    label.className = 'property-image-label';
    label.textContent = 'Property Image from ATTOM';
    
    // Add elements to container
    container.appendChild(img);
    container.appendChild(label);
    
    // Insert container before status box
    const statusBox = document.getElementById('status-box');
    statusBox.parentNode.insertBefore(container, statusBox.nextSibling);
  } else {
    console.log('No property image available in ATTOM data');
    
    // Create placeholder image container
    const container = document.createElement('div');
    container.id = 'property-image-container';
    container.className = 'property-image-container';
    
    // Create placeholder image or message
    const placeholderMsg = document.createElement('div');
    placeholderMsg.textContent = 'No property image available';
    placeholderMsg.style.padding = '20px';
    placeholderMsg.style.backgroundColor = '#f8f9fa';
    placeholderMsg.style.borderRadius = '4px';
    
    // Add to container
    container.appendChild(placeholderMsg);
    
    // Insert container before status box
    const statusBox = document.getElementById('status-box');
    statusBox.parentNode.insertBefore(container, statusBox.nextSibling);
  }
}

// Cleanup function to be called when page unloads
function cleanupObjectURLs() {
  const downloadBtn = document.getElementById('download-pdf');
  if (downloadBtn && downloadBtn.dataset.objectUrl) {
    URL.revokeObjectURL(downloadBtn.dataset.objectUrl);
  }
}

// Wait for DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', function() {
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