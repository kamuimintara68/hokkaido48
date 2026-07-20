// 北海道48路線ふらふらlog Version 4.0
// メイン地図 走破状態表示
// 未走破 = グレー / 一部走破（走破中） = 水色 / 全線走破 = 緑
(function () {
  "use strict";

  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      if (status === "走破済") {
        return "#16a34a";
      }

      if (status === "走破中") {
        return "#38bdf8";
      }

      return "#6b7280";
    };
  }
})();
