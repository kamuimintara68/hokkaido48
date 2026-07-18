"use strict";

const planList = document.getElementById("planList");
const planCount = document.getElementById("planCount");

const planFields = [
    "計画名",
    "対象路線",
    "始点",
    "終点",
    "距離(km)",
    "所要時間",
    "宿泊",
    "優先度",
    "季節",
    "メモ"
];

function textOrDefault(value) {

    const text = String(value ?? "").trim();
    return text || "未登録";
}

function createDetail(label, value, className) {

    const container = document.createElement("div");

    if (className) {
        container.className = className;
    }

    const term = document.createElement("dt");
    term.textContent = label;

    const description = document.createElement("dd");
    description.textContent = textOrDefault(value);

    container.appendChild(term);
    container.appendChild(description);
    return container;
}

function createPlanCard(plan) {

    const card = document.createElement("article");
    card.className = "plan-card";

    const title = document.createElement("h3");
    title.textContent = textOrDefault(plan["計画名"]);

    const route = document.createElement("p");
    route.className = "plan-route";
    route.textContent = "対象路線：" + textOrDefault(plan["対象路線"]);

    const details = document.createElement("dl");
    details.className = "plan-details";
    details.appendChild(createDetail("始点", plan["始点"]));
    details.appendChild(createDetail("終点", plan["終点"]));
    details.appendChild(createDetail("距離", plan["距離(km)"] === "" ? "" : `${plan["距離(km)"]} km`));
    details.appendChild(createDetail("所要時間", plan["所要時間"]));
    details.appendChild(createDetail("宿泊", plan["宿泊"]));
    details.appendChild(createDetail("優先度", plan["優先度"]));
    details.appendChild(createDetail("季節", plan["季節"]));
    details.appendChild(createDetail("メモ", plan["メモ"], "plan-memo"));

    card.appendChild(title);
    card.appendChild(route);
    card.appendChild(details);
    return card;
}

function renderPlans(plans) {

    planList.innerHTML = "";
    planCount.textContent = `${plans.length}件`;

    if (plans.length === 0) {

        const empty = document.createElement("p");
        empty.className = "empty-message";
        empty.textContent = "Excelに旅行計画はまだ登録されていません。";
        planList.appendChild(empty);
        return;
    }

    plans.forEach(plan => {
        planList.appendChild(createPlanCard(plan));
    });
}

function showLoadError(error) {

    console.error("旅行計画読込エラー:", error);
    planCount.textContent = "読込失敗";
    planList.innerHTML = "";

    const message = document.createElement("p");
    message.className = "error-message";
    message.textContent = "旅行計画Excelを読み込めませんでした。";
    planList.appendChild(message);
}

async function initializePlanViewer() {

    try {

        if (!window.XLSX) {
            throw new Error("Excel読込機能を読み込めませんでした。");
        }

        const response = await fetch(
            "data/travel_plans.xlsx",
            { cache: "no-store" }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const workbook = window.XLSX.read(
            await response.arrayBuffer(),
            { type: "array" }
        );

        const worksheet = workbook.Sheets["旅行計画"];

        if (!worksheet) {
            throw new Error("旅行計画シートがありません。");
        }

        const rows = window.XLSX.utils.sheet_to_json(
            worksheet,
            {
                header: 1,
                defval: "",
                raw: false
            }
        );

        const headers = rows[3] || [];
        const indexes = planFields.map(field => headers.indexOf(field));

        if (indexes.some(index => index < 0)) {
            throw new Error("旅行計画の項目が一致しません。");
        }

        const plans = rows
            .slice(4)
            .filter(row => row.some(value => String(value).trim()))
            .map(row => {

                const plan = {};

                planFields.forEach((field, index) => {
                    plan[field] = row[indexes[index]] ?? "";
                });

                return plan;
            });

        renderPlans(plans);

    } catch (error) {
        showLoadError(error);
    }
}

initializePlanViewer();
