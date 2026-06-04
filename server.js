/**
 * server.js - Flourish 클릭 지역별 + 월별(2026) 대출 Top10
 * (간단 B) 0건이면 무조건 "데이터 준비 중" 표시
 *
 * deps:
 *   npm i express cors fast-xml-parser
 *
 * env:
 *   DATA4LIBRARY_AUTH_KEY=발급키
 */

const express = require("express");
const cors = require("cors");
const { XMLParser } = require("fast-xml-parser");

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

const YEAR_FIXED = 2026;

const REGION_CODE_KR = {
  서울: "11",
  서울특별시: "11",

  부산: "21",
  부산광역시: "21",

  대구: "22",
  대구광역시: "22",

  인천: "23",
  인천광역시: "23",

  광주: "24",
  광주광역시: "24",

  대전: "25",
  대전광역시: "25",

  울산: "26",
  울산광역시: "26",

  세종: "29",
  세종특별자치시: "29",

  경기: "31",
  경기도: "31",

  강원: "32",
  강원도: "32",
  강원특별자치도: "32",

  충북: "33",
  충청북도: "33",

  충남: "34",
  충청남도: "34",

  전북: "35",
  전라북도: "35",
  전북특별자치도: "35",

  전남: "36",
  전라남도: "36",

  경북: "37",
  경상북도: "37",

  경남: "38",
  경상남도: "38",

  제주: "39",
  제주도: "39",
  제주특별자치도: "39",
};

function normalizeRegionName(s) {
  return String(s || "").trim();
}

function toMonthInt(monthRaw) {
  const s = String(monthRaw || "").trim();
  if (!s) return null;
  const m = Number(s);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return m;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getMonthRange(yyyy, m) {
  const end = new Date(Date.UTC(yyyy, m, 0)); // last day of month (m is 1..12)
  const startDt = `${yyyy}-${pad2(m)}-01`;
  const endDt = `${yyyy}-${pad2(m)}-${pad2(end.getUTCDate())}`;
  return { startDt, endDt };
}

async function fetchLoanTop10(regionCode, startDt, endDt) {
  const authKey = process.env.DATA4LIBRARY_AUTH_KEY;
  if (!authKey) throw new Error("missing DATA4LIBRARY_AUTH_KEY");

  const apiUrl =
    `http://data4library.kr/api/loanItemSrch` +
    `?authKey=${encodeURIComponent(authKey)}` +
    `&startDt=${encodeURIComponent(startDt)}` +
    `&endDt=${encodeURIComponent(endDt)}` +
    `&region=${encodeURIComponent(regionCode)}` +
    `&pageNo=1&pageSize=10`;

  const r = await fetch(apiUrl);
  const xml = await r.text();
  const parsed = parser.parse(xml);

  const docsRaw = parsed?.response?.docs?.doc || [];
  const docs = Array.isArray(docsRaw) ? docsRaw : docsRaw ? [docsRaw] : [];

  return docs.map((d, idx) => ({
    rank: idx + 1,
    bookname: d.bookname ?? "",
    authors: d.authors ?? "",
    publisher: d.publisher ?? "",
    publication_year: d.publication_year ?? "",
    isbn13: d.isbn13 ?? "",
    loan_count: d.loan_count ?? "",
  }));
}

/** JSON API */
app.get("/api/bestsellers", async (req, res) => {
  try {
    const regionName = normalizeRegionName(req.query.region);
    const monthInt = toMonthInt(req.query.month);

    if (!regionName) {
      return res.status(400).json({ status: "error", error: "missing region" });
    }
    if (!monthInt) {
      return res.status(400).json({
        status: "error",
        error: "missing/invalid month",
        hint: "month=1..12 (or 01..12)",
      });
    }

    const regionCode = REGION_CODE_KR[regionName];
    if (!regionCode) {
      return res.status(400).json({
        status: "error",
        error: "unknown region name",
        receivedRegion: regionName,
      });
    }

    const { startDt, endDt } = getMonthRange(YEAR_FIXED, monthInt);
    const items = await fetchLoanTop10(regionCode, startDt, endDt);

    return res.json({
      status: "ok",
      yearFixed: YEAR_FIXED,
      regionName,
      regionCode,
      month: monthInt,
      startDt,
      endDt,
      items,
    });
  } catch (e) {
    return res.status(500).json({ status: "error", error: String(e) });
  }
});

/** Popup HTML (0건이면 무조건 '데이터 준비 중') */
app.get("/popup", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  res.send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>월별 최다대출도서</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans KR", Arial, sans-serif; }
    .wrap { padding: 12px 14px; }
    .top { display: flex; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-size: 15px; font-weight: 800; margin: 0; }
    .controls { display: flex; gap: 8px; align-items: center; }
    select { font-size: 12px; padding: 6px 8px; border-radius: 8px; border: 1px solid #ddd; }
    .sub { font-size: 12px; opacity: .7; margin: 0 0 12px; }
    .card { border: 1px solid #e8e8e8; border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
    .book { font-size: 13px; font-weight: 700; margin: 0 0 6px; line-height: 1.35; }
    .meta { font-size: 12px; opacity: 0.75; line-height: 1.35; }
    .msg { border: 1px dashed #cfcfcf; border-radius: 10px; padding: 14px 12px; background: #fafafa; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1 class="title" id="title">불러오는 중...</h1>
      <div class="controls">
        <select id="monthSel" aria-label="month">
          ${Array.from({ length: 12 }, (_, i) => {
            const m = i + 1;
            return `<option value="${m}">${m}월</option>`;
          }).join("")}
        </select>
      </div>
    </div>
    <p class="sub" id="sub"></p>
    <div id="content"></div>
  </div>

  <script>
    (function () {
      const params = new URLSearchParams(location.search);
      const region = (params.get("region") || "").trim();
      const monthRaw = (params.get("month") || "").trim();

      const titleEl = document.getElementById("title");
      const subEl = document.getElementById("sub");
      const contentEl = document.getElementById("content");
      const monthSel = document.getElementById("monthSel");

      function toMonthInt(s) {
        const m = Number(String(s || "").trim());
        if (!Number.isInteger(m) || m < 1 || m > 12) return null;
        return m;
      }

      const initialMonth = toMonthInt(monthRaw) || 1;
      monthSel.value = String(initialMonth);

      function renderMsg(html) {
        contentEl.innerHTML = '<div class="msg">' + html + '</div>';
      }

      async function load() {
        const m = Number(monthSel.value);

        if (!region) {
          titleEl.textContent = "지역 미지정";
          subEl.textContent = "";
          renderMsg("<strong>region 파라미터가 없습니다.</strong><br/>예: /popup?region=서울특별시&month=5");
          return;
        }

        titleEl.textContent = region + " · 2026년 " + m + "월 대출 Top10";
        subEl.textContent = "데이터 출처: data4library.kr (loanItemSrch)";

        renderMsg("불러오는 중...");

        try {
          const r = await fetch("/api/bestsellers?region=" + encodeURIComponent(region) + "&month=" + encodeURIComponent(m));
          const data = await r.json();

          if (data.status !== "ok") {
            renderMsg("<strong>데이터 오류</strong><br/>" + (data.error || "unknown"));
            return;
          }

          subEl.textContent = "기간: " + data.startDt + " ~ " + data.endDt + " · region=" + data.regionCode;

          const items = data.items || [];

          // (간단 B) 0건이면 무조건 "데이터 준비 중"
          if (!items.length) {
            renderMsg(
              "<strong>데이터 준비 중</strong><br/>" +
              "현재 선택한 기간의 대출 데이터 준비중입니다.<br/>" +
              "다른 월을 선택해 주세요."
            );
            return;
          }

          contentEl.innerHTML = items.map(item => {
            const meta = [item.authors, item.publisher, item.publication_year].filter(Boolean).join(" · ");
            return (
              '<div class="card">' +
                '<div class="book">' + item.rank + ". " + (item.bookname || "") + '</div>' +
                '<div class="meta">' + meta + '</div>' +
              '</div>'
            );
          }).join("");
        } catch (e) {
          renderMsg("<strong>통신 오류</strong><br/>" + String(e));
        }
      }

      monthSel.addEventListener("change", load);
      load();
    })();
  </script>
</body>
</html>`);
});

/** Home */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    endpoints: [
      "/popup?region=서울특별시&month=5",
      "/api/bestsellers?region=서울특별시&month=5",
    ],
    yearFixed: YEAR_FIXED,
  });
});

app.listen(PORT, () => console.log("Server running on", PORT));
