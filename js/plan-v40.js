"use strict";

const ACTIVE_PLAN_KEY = "hokkaido48ActivePlan";
const planList = document.getElementById("planList");
const planCount = document.getElementById("planCount");
const activePlanContent = document.getElementById("activePlanContent");
const activePlanActions = document.getElementById("activePlanActions");

const requiredFields = [
  "計画名","対象路線","始点","終点","距離(km)",
  "所要時間","宿泊","優先度","季節","メモ"
];

function text(value) {
  return String(value ?? "").trim();
}

function textOrDefault(value) {
  return text(value) || "未登録";
}

function parseRouteNumbers(value) {
  return [...new Set(
    text(value)
      .normalize("NFKC")
      .split(/[,\s、，・→>\/]+/)
      .map(part => part.replace(/[^0-9]/g, ""))
      .filter(Boolean)
      .map(number => String(Number(number)))
  )];
}

function parseWaypoints(value) {
  return text(value)
    .split(/[\n\r、，|→>]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 9);
}

function buildGoogleMapsUrl(plan) {
  const savedUrl = text(plan["GoogleマップURL"]);
  if (/^https?:\/\//i.test(savedUrl)) return savedUrl;

  const origin = text(plan["始点"]);
  const destination = text(plan["終点"]);
  if (!origin || !destination) return "";

  const params = new URLSearchParams({
    api: "1",
    origin,
    destination,
    travelmode: "driving"
  });

  const waypoints = parseWaypoints(plan["経由地"]);
  if (waypoints.length) {
    params.set("waypoints", waypoints.join("|"));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function planIdentity(plan) {
  return [
    text(plan["計画名"]),
    text(plan["対象路線"]),
    text(plan["始点"]),
    text(plan["終点"])
  ].join("|");
}

function toActivePlan(plan) {
  return {
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    id: planIdentity(plan),
    planName: text(plan["計画名"]),
    targetRoutes: text(plan["対象路線"]),
    routeNumbers: parseRouteNumbers(plan["対象路線"]),
    origin: text(plan["始点"]),
    destination: text(plan["終点"]),
    waypoints: parseWaypoints(plan["経由地"]),
    googleMapsUrl: buildGoogleMapsUrl(plan),
    source: "data/travel_plans.xlsx"
  };
}

function readActivePlan() {
  const raw = localStorage.getItem(ACTIVE_PLAN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.error("今回のプラン読込エラー:", error);
    return null;
  }
}

function saveActivePlan(plan) {
  localStorage.setItem(ACTIVE_PLAN_KEY, JSON.stringify(toActivePlan(plan)));
  renderActivePlan();
  renderPlans(window.__hokkaido48Plans || []);
}

function clearActivePlan() {
  localStorage.removeItem(ACTIVE_PLAN_KEY);
  renderActivePlan();
  renderPlans(window.__hokkaido48Plans || []);
}

function createDetail(label, value, className) {
  const container = document.createElement("div");
  if (className) container.className = className;

  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = textOrDefault(value);

  container.append(term, description);
  return container;
}

function createButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function createMapLink(url, label = "Googleマップ経路を開く") {
  const link = document.createElement("a");
  link.className = "action-link google-map-link";
  link.textContent = label;
  link.target = "_blank";
  link.rel = "noopener";
  link.href = url;
  return link;
}

function renderActivePlan() {
  const active = readActivePlan();
  activePlanActions.innerHTML = "";

  if (!active) {
    activePlanContent.textContent = "まだ選択されていません。下の計画から今回走るプランを選んでください。";
    return;
  }

  const routeText = Array.isArray(active.routeNumbers) && active.routeNumbers.length
    ? active.routeNumbers.map(number => `国道${number}号`).join(" → ")
    : (active.targetRoutes || "対象路線未登録");

  activePlanContent.innerHTML = "";
  const name = document.createElement("p");
  name.innerHTML = `<strong>${active.planName || "名称未登録"}</strong>`;
  const routes = document.createElement("p");
  routes.textContent = `予定路線：${routeText}`;
  const section = document.createElement("p");
  section.textContent = `予定区間：${active.origin || "未登録"} → ${active.destination || "未登録"}`;
  activePlanContent.append(name, routes, section);

  if (active.googleMapsUrl) {
    activePlanActions.appendChild(createMapLink(active.googleMapsUrl));
  }

  const systemMapLink = document.createElement("a");
  systemMapLink.className = "action-link";
  systemMapLink.href = "index.html";
  systemMapLink.textContent = "システム地図で予定路線を見る";
  activePlanActions.appendChild(systemMapLink);

  activePlanActions.appendChild(
    createButton("今回のプラン選択を解除", "clear-plan-button", clearActivePlan)
  );
}

function createPlanCard(plan) {
  const active = readActivePlan();
  const activeId = active ? active.id : "";

  const card = document.createElement("article");
  card.className = "plan-card";
  if (activeId && activeId === planIdentity(plan)) card.classList.add("active");

  const title = document.createElement("h3");
  title.textContent = textOrDefault(plan["計画名"]);

  const route = document.createElement("p");
  route.className = "plan-route";
  route.textContent = "対象路線：" + textOrDefault(plan["対象路線"]);

  const details = document.createElement("dl");
  details.className = "plan-details";
  details.appendChild(createDetail("始点", plan["始点"]));
  details.appendChild(createDetail("終点", plan["終点"]));
  details.appendChild(createDetail("距離", text(plan["距離(km)"]) ? `${plan["距離(km)"]} km` : ""));
  details.appendChild(createDetail("所要時間", plan["所要時間"]));
  details.appendChild(createDetail("宿泊", plan["宿泊"]));
  details.appendChild(createDetail("優先度", plan["優先度"]));
  details.appendChild(createDetail("季節", plan["季節"]));
  if (text(plan["経由地"])) details.appendChild(createDetail("経由地", plan["経由地"], "plan-memo"));
  details.appendChild(createDetail("メモ", plan["メモ"], "plan-memo"));

  const actions = document.createElement("div");
  actions.className = "plan-actions";

  const googleUrl = buildGoogleMapsUrl(plan);
  if (googleUrl) actions.appendChild(createMapLink(googleUrl));

  const selectLabel = activeId && activeId === planIdentity(plan)
    ? "今回のプランに選択中"
    : "このプランを今回の予定にする";

  const selectButton = createButton(selectLabel, "select-plan-button", () => saveActivePlan(plan));
  actions.appendChild(selectButton);

  card.append(title, route, details, actions);
  return card;
}

function renderPlans(plans) {
  window.__hokkaido48Plans = plans;
  planList.innerHTML = "";
  planCount.textContent = `${plans.length}件`;

  if (!plans.length) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent = "Excelに旅行計画はまだ登録されていません。";
    planList.appendChild(empty);
    return;
  }

  plans.forEach(plan => planList.appendChild(createPlanCard(plan)));
}

function showLoadError(error) {
  console.error("旅行計画読込エラー:", error);
  planCount.textContent = "読込失敗";
  planList.innerHTML = '<p class="error-message">旅行計画Excelを読み込めませんでした。</p>';
}

async function initializePlanViewer() {
  renderActivePlan();

  try {
    if (!window.XLSX) throw new Error("Excel読込機能を読み込めませんでした。");

    const response = await fetch("data/travel_plans.xlsx", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const workbook = window.XLSX.read(await response.arrayBuffer(), { type: "array" });
    const worksheet = workbook.Sheets["旅行計画"];
    if (!worksheet) throw new Error("旅行計画シートがありません。");

    const rows = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1, defval: "", raw: false
    });

    const headers = rows[3] || [];
    const missing = requiredFields.filter(field => headers.indexOf(field) < 0);
    if (missing.length) throw new Error(`旅行計画の必須項目がありません: ${missing.join(",")}`);

    const fields = [...requiredFields];
    ["経由地", "GoogleマップURL"].forEach(field => {
      if (headers.includes(field)) fields.push(field);
    });

    const indexes = Object.fromEntries(fields.map(field => [field, headers.indexOf(field)]));

    const plans = rows
      .slice(4)
      .filter(row => row.some(value => text(value)))
      .map(row => {
        const plan = {};
        fields.forEach(field => {
          plan[field] = row[indexes[field]] ?? "";
        });
        return plan;
      });

    renderPlans(plans);
  } catch (error) {
    showLoadError(error);
  }
}

initializePlanViewer();
