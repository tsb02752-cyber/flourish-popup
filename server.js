const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.static("public"));

/**
 * (1) 팝업 페이지
 * Flourish에서 여기를 열게 됩니다:
 *   /popup?region=46
 */
app.get("/popup", (req, res) => {
  res.sendFile(__dirname + "/public/popup.html");
});

/**
 * (2) 지금은 "샘플 데이터 API"로 먼저 전체 동작을 확인합니다.
 * 나중에 Data4Library 실데이터로 교체할 겁니다.
 *
 * 호출 예:
 *   /api/bestsellers?region=46&month=2026-05
 */
app.get("/api/bestsellers", async (req, res) => {
  const region = String(req.query.region || "").trim();
  const month = String(req.query.month || "").trim(); // YYYY-MM

  if (!region) return res.status(400).json({ error: "region is required" });
  if (!month) return res.status(400).json({ error: "month is required (YYYY-MM)" });

  // ---- 샘플 데이터 (월/지역에 따라 값이 조금씩 달라지도록 만든 예시) ----
  const seed = Number(region) * 1000 + Number(month.replace("-", ""));
  const items = Array.from({ length: 10 }).map((_, i) => {
    const rank = i + 1;
    const loanCnt = Math.max(1, (seed % 200) + (11 - rank) * 7);
    return {
      rank,
      title: `샘플도서 ${rank} (${month})`,
      authors: "홍길동",
      publisher: "샘플출판사",
      isbn13: `9790000000${String(rank).padStart(3, "0")}`,
      loanCnt
    };
  });

  res.json({
    region,
    month,
    items,
    updatedAt: new Date().toISOString(),
    source: "sample"
  });
});

// Render는 PORT 환경변수를 사용
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
