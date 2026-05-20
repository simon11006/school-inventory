(function attachInventoryCore(global) {
  function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function eachDateInRange(startDate, endDate) {
    const dates = [];
    const [startYear, startMonth, startDay] = String(startDate || "").split("-").map(Number);
    const [endYear, endMonth, endDay] = String(endDate || "").split("-").map(Number);
    const cursor = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return dates;
    while (cursor <= end) {
      dates.push(formatLocalDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  function getReservationDisplayStatus(reservation, date) {
    if (reservation.selfCheckout && reservation.status === "분출됨" && reservation.startDate > date) return "예약됨";
    if (reservation.selfCheckout && reservation.status === "예약됨" && reservation.startDate <= date && reservation.endDate >= date) return "분출됨";
    return reservation.status;
  }

  function sumReservationQuantities(reservations, itemId, statuses, date, ignoreReservationId) {
    return reservations
      .filter((reservation) =>
        reservation.id !== ignoreReservationId &&
        reservation.itemId === itemId &&
        statuses.includes(reservation.status) &&
        (!date || (reservation.startDate <= date && reservation.endDate >= date))
      )
      .reduce((sum, reservation) => sum + Number(reservation.quantity || 0), 0);
  }

  function getReservedCount(state, itemId, date = "") {
    return sumReservationQuantities(state.reservations || [], itemId, ["예약됨"], date, "");
  }

  function getCheckedOutCount(state, itemId, date = "") {
    return sumReservationQuantities(state.reservations || [], itemId, ["분출됨"], date, "");
  }

  function getAvailableCountOnDate(state, itemId, date) {
    const item = (state.items || []).find((entry) => entry.id === itemId);
    if (!item) return 0;
    return Math.max(0, Number(item.total || 0) - getReservedCount(state, itemId, date) - getCheckedOutCount(state, itemId, date));
  }

  function checkReservationAvailability(state, itemId, startDate, endDate, requestQuantity, ignoreReservationId = "") {
    const item = (state.items || []).find((entry) => entry.id === itemId);
    if (!item) return { ok: false, shortages: [{ date: startDate, available: 0 }] };

    const totalAvailable = Math.max(0, Number(item.total || 0));
    const shortages = [];
    for (const date of eachDateInRange(startDate, endDate)) {
      const reservedOnDate = sumReservationQuantities(
        state.reservations || [],
        itemId,
        ["예약됨", "분출됨"],
        date,
        ignoreReservationId
      );
      const available = Math.max(0, totalAvailable - reservedOnDate);
      if (requestQuantity > available) shortages.push({ date, available });
    }
    return shortages.length ? { ok: false, shortages } : { ok: true, shortages: [] };
  }

  function matchesRecordFilter(log, filterType) {
    if (!filterType || filterType === "all") return true;
    const groups = {
      register: ["물품 등록", "일괄 등록", "물품 수정"],
      reservation: ["예약", "예약 취소"],
      checkout: ["분출", "직접 분출"],
      return: ["회수"],
      damage: ["손망 처리"],
      settings: ["학교 설정", "보안 설정"],
      operation: ["초기 구입", "현장 테스트", "피드백", "최종 점검"],
    };
    return (groups[filterType] || []).includes(log.type);
  }

  global.InventoryCore = {
    checkReservationAvailability,
    eachDateInRange,
    formatLocalDate,
    getAvailableCountOnDate,
    getCheckedOutCount,
    getReservationDisplayStatus,
    getReservedCount,
    matchesRecordFilter,
  };
})(globalThis);
