document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const fileInput = document.getElementById("file-input");
  const fileBtn = document.getElementById("file-btn");
  const uploadArea = document.getElementById("upload-area");
  const detectBtn = document.getElementById("detect-btn");
  const resetBtn = document.getElementById("reset-btn");
  const preview = document.getElementById("preview");
  const statusDiv = document.getElementById("status");
  const cameraBtn = document.getElementById("camera-btn");
  const cameraArea = document.getElementById("camera-area");
  const cameraPreview = document.getElementById("camera-preview");
  const captureBtn = document.getElementById("capture-btn");
  const closeCameraBtn = document.getElementById("close-camera-btn");
  const detectedObjectsSection = document.getElementById("detected-objects-section");
  const detectedObjectsList = document.getElementById("detected-objects");
  const generateRecipeBtn = document.getElementById("generate-recipe");
  const recipeResult = document.getElementById("recipe-result");
  const recipeText = document.getElementById("recipe-text");
  const fileInfo = document.getElementById("file-info");

  let currentStreamUrl = "";
  let cameraStream = null;
  let lastDetectedObjects = [];

  // Fix: Only trigger file input on specific button click, not entire upload area
  fileBtn.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent event bubbling to upload area
    fileInput.click();
  });

  // Upload Area Interactions - keep for drag and drop functionality
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("active");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("active");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("active");

    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFileChange();
    }
  });

  fileInput.addEventListener("change", handleFileChange);

  // Camera Capture Logic 
  cameraBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      // Hide upload area, show camera area
      uploadArea.style.display = "none";
      cameraArea.style.display = "block";
      preview.style.display = "none";
      
      // Show camera controls
      cameraPreview.style.display = "block";
      captureBtn.style.display = "inline-block";
      closeCameraBtn.style.display = "inline-block";
      
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      cameraPreview.srcObject = cameraStream;
      await cameraPreview.play();
    } catch (err) {
      console.error("Camera error:", err);
      showStatus("Camera access denied or not available.", "error");
      cameraArea.style.display = "none";
      uploadArea.style.display = "block";
    }
  });

  captureBtn.addEventListener("click", () => {
    const canvas = document.createElement("canvas");
    canvas.width = cameraPreview.videoWidth || 320;
    canvas.height = cameraPreview.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          fileInput.files = dataTransfer.files;
          handleFileChange();
          
          // Hide camera, show upload area
          cameraArea.style.display = "none";
          uploadArea.style.display = "block";
          
          // Hide camera controls
          cameraPreview.style.display = "none";
          captureBtn.style.display = "none";
          closeCameraBtn.style.display = "none";
          
          // Stop camera
          stopCamera();
        }
      },
      "image/jpeg"
    );
  });

  closeCameraBtn.addEventListener("click", () => {
    cameraArea.style.display = "none";
    uploadArea.style.display = "block";
    preview.style.display = "none";
    
    // Hide camera controls
    cameraPreview.style.display = "none";
    captureBtn.style.display = "none";
    closeCameraBtn.style.display = "none";
    
    stopCamera();
  });

  // Helper function to stop camera stream
  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
  }

  // Detect Button Logic 
  detectBtn.addEventListener("click", async () => {
    if (!fileInput.files.length) {
      return showStatus("Please select or capture an image first", "error");
    }

    // Hide upload area on detect
    uploadArea.style.display = "none";
    preview.style.display = "none";
    statusDiv.style.display = "none";
    detectedObjectsSection.style.display = "none";
    recipeResult.style.display = "none";
    detectedObjectsList.innerHTML = "";
    lastDetectedObjects = [];
    generateRecipeBtn.disabled = true;

    const file = fileInput.files[0];

    detectBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Processing...';
    detectBtn.disabled = true;
    showStatus("Processing...", "loading");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/detect`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      // Get detected objects from header
      const detectedHeader = response.headers.get("X-Detected-Objects");
      let detectedObjects = [];
      if (detectedHeader) {
        detectedObjects = detectedHeader.split(",").filter(Boolean);
      }
      lastDetectedObjects = detectedObjects;
      detectedObjectsList.innerHTML = "";
      if (detectedObjects.length > 0) {
        detectedObjects.forEach((obj) => {
          const li = document.createElement("li");
          li.textContent = obj;
          detectedObjectsList.appendChild(li);
        });
        detectedObjectsSection.style.display = "block";
        generateRecipeBtn.disabled = false;
      } else {
        detectedObjectsSection.style.display = "block";
        detectedObjectsList.innerHTML = '<li>No objects detected.</li>';
        generateRecipeBtn.disabled = true;
      }

      const blob = await response.blob();
      if (currentStreamUrl) {
        URL.revokeObjectURL(currentStreamUrl);
      }
      currentStreamUrl = URL.createObjectURL(blob);
      preview.src = currentStreamUrl;
      preview.style.display = "block";
      showStatus("Detection completed!", "success");
    } catch (error) {
      console.error(error);
      showStatus(error.message, "error");
    } finally {
      detectBtn.innerHTML = '<i class="fas fa-search"></i> Detect Objects';
      detectBtn.disabled = false;
    }
  });

  // Generate Recipe Button Logic
  generateRecipeBtn.addEventListener("click", async () => {
    if (!lastDetectedObjects.length) return;
    generateRecipeBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    generateRecipeBtn.disabled = true;
    recipeResult.style.display = "none";
    recipeText.textContent = "";
    recipeText.innerHTML = "";
    showStatus("Generating recipe...", "loading");
    try {
      const response = await fetch("/recipe/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: lastDetectedObjects }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = await response.json();
      // Prefer HTML recipe if available
      if (data.recipe_html) {
        recipeText.innerHTML = data.recipe_html;
      } else {
        recipeText.textContent = data.recipe || "No recipe found.";
      }
      recipeResult.style.display = "block";
      showStatus("Recipe generated!", "success");
    } catch (error) {
      recipeText.textContent = "Error generating recipe.";
      recipeResult.style.display = "block";
      showStatus(error.message, "error");
    } finally {
      generateRecipeBtn.innerHTML = 'Generate Recipe';
      generateRecipeBtn.disabled = false;
    }
  });

  // Improved Reset Button Logic 
  resetBtn.addEventListener("click", () => {
    // Clear file input
    fileInput.value = "";
    
    // Hide and clear preview image
    if (preview.src) {
      if (currentStreamUrl) {
        URL.revokeObjectURL(currentStreamUrl);
        currentStreamUrl = "";
      }
      preview.src = "";
      preview.style.display = "none";
    }
    
    // Hide status message
    statusDiv.style.display = "none";
    
    // Show upload area again
    uploadArea.style.display = "block";
    
    // Clear file info
    fileInfo.textContent = "";
    
    // Hide detected objects section
    detectedObjectsSection.style.display = "none";
    
    // Clear detected objects list
    detectedObjectsList.innerHTML = "";
    
    // Reset detected objects array
    lastDetectedObjects = [];
    
    // Hide recipe result section
    recipeResult.style.display = "none";
    
    // Clear recipe text
    recipeText.textContent = "";
    recipeText.innerHTML = "";
    
    // Disable generate recipe button
    generateRecipeBtn.disabled = true;
    
    // Ensure camera is closed if it was open
    stopCamera();
    
    // Hide camera area and controls
    cameraArea.style.display = "none";
    cameraPreview.style.display = "none";
    captureBtn.style.display = "none";
    closeCameraBtn.style.display = "none";
    
    showStatus("Reset completed. Ready for a new image.", "success");
    setTimeout(() => {
      statusDiv.style.display = "none";
    }, 2000);
  });

  // File Change Handler - Improved
  function handleFileChange() {
    const file = fileInput.files[0];
    if (!file) return;
    
    // Update file info display
    fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
    
    // Clear previous preview
    if (preview.src && currentStreamUrl) {
      URL.revokeObjectURL(currentStreamUrl);
    }
    
    // Create and display new preview
    currentStreamUrl = URL.createObjectURL(file);
    preview.src = currentStreamUrl;
    preview.style.display = "block";
    
    // Reset detection results when new file is selected
    detectedObjectsSection.style.display = "none";
    detectedObjectsList.innerHTML = "";
    recipeResult.style.display = "none";
    lastDetectedObjects = [];
  }

  // Status Display Helper 
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = "block";
  }

  // Cleanup on Unload 
  window.addEventListener("beforeunload", () => {
    if (currentStreamUrl) {
      URL.revokeObjectURL(currentStreamUrl);
    }
    stopCamera();
  });
});


//website responsiveness

