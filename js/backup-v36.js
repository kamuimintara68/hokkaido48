"use strict";

const BACKUP_FORMAT = "hokkaido48-backup";
const BACKUP_VERSION = 1;
const APP_VERSION = "3.6";
const TRIP_STORAGE_KEY = "hokkaido48Trips";
const RECORD_KEY_PATTERN = /^route\d{3}Record$/;

const currentSummary = document.getElementById("currentSummary");
const currentWarning = document.getElementById("currentWarning");
const exportMessage = document.getElementById("exportMessage");
const restoreMessage = document.getElementById("restoreMessage");
const importPreview = document.getElementById("importPreview");
const backupFileInput = document.getElementById("backupFileInput");
const preRestoreButton = document.getElementById("preRestoreButton");
const restoreButton = document.getElementById("restoreButton");

let selectedBackup = null;
let selectedAnalysis = null;
let preRestoreFingerprint = null;


function isManagedKey(key) {
    return (
        key === TRIP_STORAGE_KEY ||
        RECORD_KEY_PATTERN.test(key)
    );
}


function getManagedKeys() {

    const keys = [];

    for (let index = 0; index < localStorage.length; index += 1) {

        const key = localStorage.key(index);

        if (key && isManagedKey(key)) {
            keys.push(key);
        }
    }

    return keys.sort();
}


function collectManagedStorage() {

    const storage = {};

    getManagedKeys().forEach(key => {

        const value = localStorage.getItem(key);

        if (value !== null) {
            storage[key] = value;
        }
    });

    return storage;
}


function createSnapshot() {

    return {
        format: BACKUP_FORMAT,
        backupVersion: BACKUP_VERSION,
        appVersion: APP_VERSION,
        exportedAt: new Date().toISOString(),
        sourcePage: window.location.href,
        storage: collectManagedStorage()
    };
}


function analyzeStorage(storage, strict) {

    if (
        !storage ||
        typeof storage !== "object" ||
        Array.isArray(storage)
    ) {
        throw new Error("保存データの構成を確認できません。");
    }

    const analysis = {
        tripCount: 0,
        recordCount: 0,
        warnings: []
    };

    Object.entries(storage).forEach(([key, rawValue]) => {

        if (!isManagedKey(key)) {

            if (strict) {
                throw new Error("対象外の保存項目が含まれています。");
            }

            return;
        }

        if (typeof rawValue !== "string") {
            throw new Error(key + " の保存形式を確認できません。");
        }

        try {

            const parsed = JSON.parse(rawValue);

            if (key === TRIP_STORAGE_KEY) {

                if (!Array.isArray(parsed)) {
                    throw new Error("Tripが配列形式ではありません。");
                }

                if (
                    parsed.some(item =>
                        !item ||
                        typeof item !== "object" ||
                        Array.isArray(item)
                    )
                ) {
                    throw new Error("Tripに確認できない項目があります。");
                }

                analysis.tripCount = parsed.length;

            } else {

                if (
                    !parsed ||
                    typeof parsed !== "object" ||
                    Array.isArray(parsed)
                ) {
                    throw new Error("Recordがオブジェクト形式ではありません。");
                }

                analysis.recordCount += 1;
            }

        } catch (error) {

            if (strict) {
                throw new Error(
                    key + " を読み込めません。 " + error.message
                );
            }

            analysis.warnings.push(
                key + " を読み込めません。元の文字列はバックアップへ保存できます。"
            );
        }
    });

    return analysis;
}


function validateBackup(backup) {

    if (
        !backup ||
        typeof backup !== "object" ||
        Array.isArray(backup)
    ) {
        throw new Error("バックアップファイルの形式を確認できません。");
    }

    if (backup.format !== BACKUP_FORMAT) {
        throw new Error("北海道48路線ふらふらlogのバックアップではありません。");
    }

    if (backup.backupVersion !== BACKUP_VERSION) {
        throw new Error("対応していないバックアップ形式です。");
    }

    return analyzeStorage(backup.storage, true);
}


function pad(value) {
    return String(value).padStart(2, "0");
}


function createTimestamp() {

    const date = new Date();

    return (
        date.getFullYear() +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) +
        "_" +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
    );
}


function downloadBlob(blob, fileName) {

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);
}


function downloadSnapshot(prefix) {

    const snapshot = createSnapshot();
    const blob = new Blob(
        [JSON.stringify(snapshot, null, 2)],
        {
            type: "application/json;charset=utf-8"
        }
    );

    downloadBlob(
        blob,
        prefix + "_" + createTimestamp() + ".json"
    );

    return snapshot;
}


function formatSummary(analysis) {

    return (
        "Trip：" + analysis.tripCount + "件\n" +
        "RouteごとのRecord：" + analysis.recordCount + "件"
    );
}


function refreshCurrentSummary() {

    try {

        const storage = collectManagedStorage();
        const analysis = analyzeStorage(storage, false);

        currentSummary.textContent = formatSummary(analysis);

        if (analysis.warnings.length > 0) {
            currentWarning.hidden = false;
            currentWarning.textContent = analysis.warnings.join("\n");
        } else {
            currentWarning.hidden = true;
            currentWarning.textContent = "";
        }

    } catch (error) {

        currentSummary.textContent =
            "現在の保存データを確認できませんでした。";
        currentWarning.hidden = false;
        currentWarning.textContent = error.message;
    }
}


function resetRestorePreparation() {

    preRestoreFingerprint = null;
    restoreButton.disabled = true;
}


document
    .getElementById("exportButton")
    .addEventListener("click", function () {

        try {

            const snapshot = downloadSnapshot("hokkaido48_backup");
            const analysis = analyzeStorage(snapshot.storage, false);

            exportMessage.textContent =
                "Trip・Recordのバックアップを書き出しました。\n" +
                formatSummary(analysis);

        } catch (error) {

            console.error("バックアップ書出しエラー:", error);
            exportMessage.textContent =
                "バックアップを書き出せませんでした。 " +
                error.message;
        }
    });


document
    .getElementById("excelBackupButton")
    .addEventListener("click", async function () {

        exportMessage.textContent =
            "公開中のExcel旅行計画を読み込んでいます。";

        try {

            const response = await fetch(
                "data/travel_plans.xlsx",
                {
                    cache: "no-store"
                }
            );

            if (!response.ok) {
                throw new Error("Excelファイルを読み込めません。");
            }

            const blob = await response.blob();

            downloadBlob(
                blob,
                "travel_plans_backup_" +
                createTimestamp() +
                ".xlsx"
            );

            exportMessage.textContent =
                "公開中のExcel旅行計画を書き出しました。";

        } catch (error) {

            console.error("Excelバックアップエラー:", error);
            exportMessage.textContent =
                "Excel旅行計画を書き出せませんでした。 " +
                error.message;
        }
    });


backupFileInput.addEventListener("change", async function () {

    selectedBackup = null;
    selectedAnalysis = null;
    preRestoreButton.disabled = true;
    resetRestorePreparation();
    restoreMessage.textContent = "";

    const file = backupFileInput.files[0];

    if (!file) {
        importPreview.textContent =
            "バックアップファイルはまだ選ばれていません。";
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        importPreview.textContent =
            "ファイルが大きすぎるため読み込めません。";
        return;
    }

    try {

        const text = await file.text();
        const backup = JSON.parse(text);
        const analysis = validateBackup(backup);

        selectedBackup = backup;
        selectedAnalysis = analysis;
        preRestoreButton.disabled = false;

        importPreview.textContent =
            "ファイル：" + file.name + "\n" +
            "作成日時：" + (backup.exportedAt || "記録なし") + "\n" +
            "作成Version：" + (backup.appVersion || "記録なし") + "\n" +
            formatSummary(analysis);

        restoreMessage.textContent =
            "内容を確認しました。現在のデータは変更していません。";

    } catch (error) {

        console.error("バックアップ読込エラー:", error);
        importPreview.textContent =
            "このファイルは復元に使用できません。\n" +
            error.message;
    }
});


preRestoreButton.addEventListener("click", function () {

    if (!selectedBackup) {
        return;
    }

    try {

        const snapshot =
            downloadSnapshot("hokkaido48_before_restore");

        preRestoreFingerprint =
            JSON.stringify(snapshot.storage);

        restoreButton.disabled = false;
        restoreMessage.textContent =
            "復元直前のバックアップを書き出しました。復元を実行できます。";

    } catch (error) {

        console.error("復元前バックアップエラー:", error);
        resetRestorePreparation();
        restoreMessage.textContent =
            "復元前バックアップを書き出せないため、復元は実行しません。";
    }
});


function replaceManagedStorage(targetStorage) {

    const previousStorage = collectManagedStorage();

    try {

        getManagedKeys().forEach(key => {
            localStorage.removeItem(key);
        });

        Object.entries(targetStorage).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });

    } catch (error) {

        try {

            getManagedKeys().forEach(key => {
                localStorage.removeItem(key);
            });

            Object.entries(previousStorage).forEach(([key, value]) => {
                localStorage.setItem(key, value);
            });

        } catch (rollbackError) {

            console.error(
                "復元失敗後の巻き戻しエラー:",
                rollbackError
            );

            throw new Error(
                "復元と巻き戻しに失敗しました。復元前バックアップファイルを保管してください。"
            );
        }

        throw new Error(
            "復元に失敗したため、元の保存データへ戻しました。"
        );
    }
}


restoreButton.addEventListener("click", function () {

    if (!selectedBackup || !selectedAnalysis) {
        return;
    }

    const currentFingerprint =
        JSON.stringify(collectManagedStorage());

    if (currentFingerprint !== preRestoreFingerprint) {

        resetRestorePreparation();
        restoreMessage.textContent =
            "復元前バックアップの後に保存データが変わりました。もう一度、復元前バックアップを書き出してください。";
        return;
    }

    const confirmed = window.confirm(
        "現在のTrip・Recordを、選択したバックアップの内容へ置き換えます。\n" +
        formatSummary(selectedAnalysis) +
        "\n\n復元を実行しますか？"
    );

    if (!confirmed) {
        restoreMessage.textContent =
            "復元を中止しました。現在のデータは変更していません。";
        return;
    }

    try {

        replaceManagedStorage(selectedBackup.storage);
        resetRestorePreparation();
        refreshCurrentSummary();

        restoreMessage.textContent =
            "バックアップから復元しました。地図またはTrip画面へ戻って確認してください。";

    } catch (error) {

        console.error("バックアップ復元エラー:", error);
        resetRestorePreparation();
        refreshCurrentSummary();
        restoreMessage.textContent = error.message;
    }
});


window.addEventListener("storage", function (event) {

    if (event.key && isManagedKey(event.key)) {
        refreshCurrentSummary();
        resetRestorePreparation();
    }
});


refreshCurrentSummary();

