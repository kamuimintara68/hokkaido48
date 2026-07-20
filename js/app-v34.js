// 北海道48路線ふらふらlog Version 4.0
// メイン地図基本色：未走破・一部走破=グレー、全線走破=緑
(function () {
  "use strict";

  if (typeof getStatusColor === "function") {
    getStatusColor = function (status) {
      return status === "走破済"
        ? "#16a34a"
        : "#6b7280";
    };
  }
})();
