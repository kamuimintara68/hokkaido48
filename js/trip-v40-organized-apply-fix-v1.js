"use strict";

(function () {
    const applyButton = document.getElementById("applyOrganizedTranscriptButton");
    if (!applyButton) return;

    const mappings = [
        ["organizedActionLog", "actionLog"],
        ["organizedTimeline", "timeline"],
        ["organizedImpressions", "impressions"],
        ["organizedImprovements", "improvements"],
        ["organizedFerment", "ferment"]
    ];

    function mergeText(existingText, incomingText) {
        const existing = String(existingText || "").trim();
        const incoming = String(incomingText || "").trim();
        if (!incoming) return existing;
        if (!existing || existing === incoming) return incoming;
        return `${existing}\n\n${incoming}`;
    }

    applyButton.addEventListener("click", function () {
        mappings.forEach(([sourceId, targetId]) => {
            const source = document.getElementById(sourceId);
            const target = document.getElementById(targetId);
            if (!source || !target) return;
            target.value = mergeText(target.value, source.value);
            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
        });

        const msg = document.getElementById("transcriptOrganizerMessage");
        if (msg) {
            msg.textContent =
                "整理結果をTrip入力欄へ反映しました。まだ正式保存していません。内容を確認してから「保存」を押してください。";
        }
    }, true);
})();
