(function () {
  "use strict";

  const allInput = document.getElementById("allMaterialFiles");
  const allStatus = document.getElementById("allMaterialSelection");
  const gpxInput = document.getElementById("gpxFiles");
  const audioInput = document.getElementById("audioFiles");
  const photoInput = document.getElementById("photoFiles");
  const clearButton = document.getElementById("clearButton");

  if (!allInput || !gpxInput || !audioInput || !photoInput) return;

  const GPX = new Set(["gpx"]);
  const AUDIO_TEXT = new Set(["wma", "m4a", "mp3", "wav", "aac", "txt"]);
  const PHOTO = new Set(["jpg", "jpeg", "png", "heic", "heif"]);

  function extension(name) {
    const parts = String(name || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function assignFiles(input, files) {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function classify(files) {
    const groups = { gpx: [], audio: [], photo: [], unknown: [] };

    files.forEach(file => {
      const ext = extension(file.name);
      if (GPX.has(ext)) groups.gpx.push(file);
      else if (AUDIO_TEXT.has(ext) || String(file.type || "").startsWith("audio/") || file.type === "text/plain") groups.audio.push(file);
      else if (PHOTO.has(ext) || String(file.type || "").startsWith("image/")) groups.photo.push(file);
      else groups.unknown.push(file);
    });

    return groups;
  }

  allInput.addEventListener("change", function () {
    const files = Array.from(allInput.files || []);
    const groups = classify(files);

    assignFiles(gpxInput, groups.gpx);
    assignFiles(audioInput, groups.audio);
    assignFiles(photoInput, groups.photo);

    const parts = [
      `合計${files.length}件`,
      `GPX ${groups.gpx.length}件`,
      `音声・TXT ${groups.audio.length}件`,
      `写真 ${groups.photo.length}件`
    ];

    if (groups.unknown.length) {
      parts.push(`未分類 ${groups.unknown.length}件`);
    }

    allStatus.textContent = files.length ? parts.join("／") : "未選択";
  });

  if (clearButton) {
    clearButton.addEventListener("click", function () {
      allInput.value = "";
      allStatus.textContent = "未選択";
    });
  }
})();
