// 出張管理カレンダー JavaScript（Supabase対応版）
//
// 使うもの
// - Data API の Project URL
// - API Keys の Publishable key（sb_publishable_〜）
//
// 注意
// - insert / update / delete は RLS で「admins の人だけ」になる想定
// - ログイン（アクセストークン）が無いと保存・削除は失敗します
//   （閲覧はOK）

// 1) ここだけ差し替え
const SUPABASE_URL = "https://ojwiblktgtfxzrfrznmr.supabase.co"; // Data API の Project URL
const SUPABASE_ANON_KEY = "sb_publishable_JS4Wr6jACtuQ1tcsNdXKAQ_VX1cD35Y"; // Publishable key（sb_publishable_〜）



// 日付をローカル(日本時間)で YYYY-MM-DD にする（toISOString禁止：前日ズレ対策）
function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
// 2) app.js と共通で使うトークン保存キー
const SB_TOKEN_KEY = "sb_access_token";

// 3) Supabase REST（PostgREST）ユーティリティ
function sbHeaders(withAuth = false) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  };
  if (withAuth) {
    const token = sessionStorage.getItem(SB_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function sbRequest(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;

  return await res.json();
}

async function sbSelect(table, queryString = "") {
  return await sbRequest(`/rest/v1/${table}?select=*${queryString}`, {
    method: "GET",
    headers: sbHeaders(false),
  });
}

async function sbSelectOneById(table, id) {
  const rows = await sbRequest(`/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(id)}`, {
    method: "GET",
    headers: sbHeaders(false),
  });
  return rows && rows[0] ? rows[0] : null;
}

async function sbInsert(table, payload) {
  return await sbRequest(`/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbHeaders(true), Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
}

async function sbUpdateById(table, id, payload) {
  return await sbRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sbHeaders(true), Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
}

async function sbDeleteById(table, id) {
  return await sbRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: sbHeaders(true),
  });
}

// 4) 社員（カラー）はローカル保存で管理（DBには入れない）
const EMPLOYEES_LS_KEY = "employees_v1";

// 出張管理カレンダー本体
class BusinessTripCalendar {
  constructor() {
    this.currentDate = new Date();
    this.viewMode = "month"; // 'month' or 'week'
    this.events = [];
    this.employees = [];

    this.colors = [
      "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
      "#DDA0DD", "#FFB347", "#87CEEB", "#FF9FF3", "#54A0FF",
    ];

    this.init();
  }

  init() {
    this.bindEvents();
    this.loadEmployees();
    this.updateMonthDisplay();
    this.loadBusinessTrips();
    this.renderCalendar();
    this.renderHotelList();
  }

  bindEvents() {
    // ナビゲーション
    document.getElementById("prevBtn")?.addEventListener("click", () => this.navigate(-1));
    document.getElementById("nextBtn")?.addEventListener("click", () => this.navigate(1));
    document.getElementById("todayBtn")?.addEventListener("click", () => this.goToToday());

    // ビューモード
    document.getElementById("monthView")?.addEventListener("click", () => this.setViewMode("month"));
    document.getElementById("weekView")?.addEventListener("click", () => this.setViewMode("week"));

    // モーダル操作
    document.getElementById("saveEvent")?.addEventListener("click", () => this.saveEvent());
    document.getElementById("deleteEvent")?.addEventListener("click", () => this.deleteEvent());
    document.getElementById("addEmployeeBtn")?.addEventListener("click", () => this.showEmployeeModal());
    document.getElementById("saveEmployee")?.addEventListener("click", () => this.saveEmployee());

    // カラーピッカー
    document.addEventListener("click", (e) => {
      if (e.target?.classList?.contains("color-option")) {
        document.querySelectorAll(".color-option").forEach((el) => el.classList.remove("selected"));
        e.target.classList.add("selected");
        const selected = document.getElementById("selectedColor");
        if (selected) selected.value = e.target.dataset.color;
      }
    });

    // モーダル閉じたらリセット
    const eventModal = document.getElementById("eventModal");
    eventModal?.addEventListener("hidden.bs.modal", () => this.resetEventForm());
  }

  // employees
  loadEmployees() {
    try {
      const saved = localStorage.getItem(EMPLOYEES_LS_KEY);
      if (saved) {
        this.employees = JSON.parse(saved);
      } else {
        this.employees = [];
        this.saveEmployees();
      }
      this.renderEmployeeColors();
      this.populateEmployeeSelect();
    } catch (e) {
      console.error("社員情報の読み込みに失敗しました:", e);
      this.employees = [];
    }
  }

  saveEmployees() {
    localStorage.setItem(EMPLOYEES_LS_KEY, JSON.stringify(this.employees));
  }

  ensureEmployeeByName(name) {
    if (!name) return null;
    let emp = this.employees.find((e) => e.name === name);
    if (emp) return emp;

    const color = this.colors[this.employees.length % this.colors.length];
    emp = { id: "emp_" + Date.now() + "_" + Math.floor(Math.random() * 1000), name, color };
    this.employees.push(emp);
    this.saveEmployees();
    this.renderEmployeeColors();
    this.populateEmployeeSelect();
    return emp;
  }

  getEmployeeIdByName(name) {
    const emp = this.employees.find((e) => e.name === name);
    return emp ? emp.id : null;
  }

  getEmployeeNameById(employeeId) {
    const emp = this.employees.find((e) => e.id === employeeId);
    return emp ? emp.name : "";
  }

  getEmployeeColor(employeeId) {
    const emp = this.employees.find((e) => e.id === employeeId);
    return emp ? emp.color : "#6c757d";
  }

  renderEmployeeColors() {
    const container = document.getElementById("employeeColors");
    if (!container) return;

    if (!this.employees.length) {
      container.innerHTML = '<div class="text-muted">社員が未登録です</div>';
      return;
    }

    container.innerHTML = this.employees
      .map(
        (emp) => `
        <div class="employee-color-item">
          <div class="color-indicator" style="background-color: ${emp.color}"></div>
          <span class="employee-name">${this.escapeHtml(emp.name)}</span>
        </div>
      `
      )
      .join("");
  }

  populateEmployeeSelect() {
    const select = document.getElementById("eventEmployee");
    if (!select) return;

    select.innerHTML =
      '<option value="">社員を選択してください</option>' +
      this.employees.map((emp) => `<option value="${emp.id}">${this.escapeHtml(emp.name)}</option>`).join("");
  }

  // trips
  async loadBusinessTrips() {
    try {
      const rows = await sbSelect("business_trips", "&order=start_date.asc&limit=1000");

      // DB上の社員名がローカルに無ければ自動登録（色付けのため）
      rows.forEach((trip) => {
        if (trip?.employee_name) this.ensureEmployeeByName(trip.employee_name);
      });

      this.events = rows.map((trip) => {
        const empId = this.getEmployeeIdByName(trip.employee_name) || (this.ensureEmployeeByName(trip.employee_name)?.id ?? null);
        return {
          id: trip.id,
          employeeId: empId,
          employeeName: trip.employee_name,
          destination: trip.destination,
          startDate: trip.start_date ? new Date(trip.start_date) : null,
          endDate: trip.end_date ? new Date(trip.end_date) : null,
          hotel: trip.hotel || "",
          hotelCheckIn: trip.hotel_check_in || null,
          hotelCheckOut: trip.hotel_check_out || null,
          hotelType: trip.hotel_type || "",
          notes: trip.notes || "",
        };
      });

      this.renderCalendar();
      this.renderHotelList();
    } catch (e) {
      console.error("出張情報の読み込みに失敗しました:", e);
      this.showAlert("出張情報の読み込みに失敗しました", "danger");
    }
  }

  // calendar render
  renderCalendar() {
    const calendarEl = document.getElementById("calendar");
    if (!calendarEl) return;

    calendarEl.innerHTML = "";
    if (this.viewMode === "month") this.renderMonthView(calendarEl);
    else this.renderWeekView(calendarEl);
  }

  renderMonthView(container) {
  const header = document.createElement("div");
  header.className = "calendar-header";

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  weekdays.forEach((day) => {
    const cell = document.createElement("div");
    cell.className = "calendar-header-cell";
    cell.textContent = day;
    header.appendChild(cell);
  });
  container.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const year = this.currentDate.getFullYear();
  const month = this.currentDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const periodEvents = this.processPeriodEvents();

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + i);
    cellDate.setHours(0, 0, 0, 0);

    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    cell.dataset.date = formatDateLocal(cellDate);

    if (cellDate.getMonth() !== month) cell.classList.add("other-month");
    if (cellDate.getTime() === today.getTime()) cell.classList.add("today");

    const dateNumber = document.createElement("div");
    dateNumber.className = "date-number";
    dateNumber.textContent = String(cellDate.getDate());
    cell.appendChild(dateNumber);

    const eventsContainer = document.createElement("div");
    eventsContainer.className = "calendar-events";

    const dayPeriodEvents = periodEvents.filter((pe) => cellDate >= pe.startDate && cellDate <= pe.endDate);

    if (dayPeriodEvents.length > 0) {
      dayPeriodEvents.forEach((periodEvent) => {
        if (cellDate.getTime() === periodEvent.startDate.getTime()) {
          eventsContainer.appendChild(this.createPeriodEventElement(periodEvent));
        } else {
          eventsContainer.appendChild(this.createPeriodEventContinuationElement(periodEvent));
        }
      });
    } else {
      const periodIds = new Set(periodEvents.map(pe => pe.id));
      const dayEvents = this.getEventsForDate(cellDate).filter(ev => !periodIds.has(ev.id));
      dayEvents.forEach((ev) => eventsContainer.appendChild(this.createEventElement(ev, false)));
    }



    cell.appendChild(eventsContainer);

    cell.addEventListener("click", (e) => {
      if (!e.target.closest(".calendar-event")) this.showEventModal(cellDate);
    });

    grid.appendChild(cell);
  }

  container.appendChild(grid);
}


  renderWeekView(container) {
    const startOfWeek = new Date(this.currentDate);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const header = document.createElement("div");
    header.className = "calendar-header";
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);

      const cell = document.createElement("div");
      cell.className = "calendar-header-cell";
      cell.innerHTML = `
        <div>${weekdays[i]}</div>
        <div style="font-size: 0.8rem; font-weight: normal;">${date.getMonth() + 1}/${date.getDate()}</div>
      `;
      header.appendChild(cell);
    }
    container.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "calendar-grid";
    grid.style.gridTemplateRows = "1fr";

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      date.setHours(0, 0, 0, 0);

      const cell = document.createElement("div");
      cell.className = "calendar-cell";
      cell.dataset.date = formatDateLocal(date);

      if (date.getTime() === today.getTime()) cell.classList.add("today");

      const eventsContainer = document.createElement("div");
      eventsContainer.className = "calendar-events";

      const dayEvents = this.getEventsForDate(date);
      dayEvents.forEach((ev) => eventsContainer.appendChild(this.createEventElement(ev, true)));

      cell.appendChild(eventsContainer);

      cell.addEventListener("click", (e) => {
        if (!e.target.closest(".calendar-event")) this.showEventModal(date);
      });

      grid.appendChild(cell);
    }

    container.appendChild(grid);
  }

  processPeriodEvents() {
    const periodEvents = [];
    this.events.forEach((event) => {
      if (!event.startDate || !event.endDate) return;

      const startDate = new Date(event.startDate);
      const endDate = new Date(event.endDate);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
      if (diffDays >= 3) {
        periodEvents.push({
          id: event.id,
          employeeId: event.employeeId,
          employeeName: event.employeeName,
          destination: event.destination,
          startDate,
          endDate,
          hotel: event.hotel,
          color: this.getEmployeeColor(event.employeeId),
        });
      }
    });
    return periodEvents;
  }

  createPeriodEventElement(periodEvent) {
    const eventEl = document.createElement("div");
    eventEl.className = "calendar-event period-event";
    eventEl.style.backgroundColor = periodEvent.color;

    const titleEl = document.createElement("div");
    titleEl.className = "event-title";
    titleEl.textContent = periodEvent.employeeName;

    const periodEl = document.createElement("div");
    periodEl.className = "event-period";
    periodEl.textContent = `${periodEvent.startDate.getMonth() + 1}/${periodEvent.startDate.getDate()}～${periodEvent.endDate.getMonth() + 1}/${periodEvent.endDate.getDate()}`;

    const locationEl = document.createElement("div");
    locationEl.className = "event-location";
    locationEl.textContent = periodEvent.destination;

    eventEl.appendChild(titleEl);
    eventEl.appendChild(periodEl);
    eventEl.appendChild(locationEl);

    eventEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.editEvent(periodEvent.id);
    });

    return eventEl;
  }

  createPeriodEventContinuationElement(periodEvent) {
  const eventEl = document.createElement("div");
  eventEl.className = "calendar-event period-event cont";
  eventEl.style.backgroundColor = periodEvent.color;

  // 続き部分は文字なし（帯に見せる）
  eventEl.innerHTML = "&nbsp;";

  eventEl.addEventListener("click", (e) => {
    e.stopPropagation();
    this.editEvent(periodEvent.id);
  });

  return eventEl;
}

  createEventElement(event, isWeekView) {
    const eventEl = document.createElement("div");
    eventEl.className = "calendar-event";
    eventEl.style.backgroundColor = this.getEmployeeColor(event.employeeId);

    const titleEl = document.createElement("div");
    titleEl.className = "event-title";
    titleEl.textContent = event.employeeName;

    const locationEl = document.createElement("div");
    locationEl.className = "event-location";
    locationEl.textContent = event.destination;

    eventEl.appendChild(titleEl);
    if (!isWeekView) eventEl.appendChild(locationEl);

    eventEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.editEvent(event.id);
    });

    return eventEl;
  }

  getEventsForDate(date) {
    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    return this.events.filter((ev) => {
      if (!ev.startDate || !ev.endDate) return false;

      const s = new Date(ev.startDate);
      const e = new Date(ev.endDate);
      s.setHours(0, 0, 0, 0);
      e.setHours(0, 0, 0, 0);

      return target >= s && target <= e;
    });
  }

  // hotel list
  renderHotelList() {
    const container = document.getElementById("hotelList");
    if (!container) return;

    const hotels = {};
    this.events.forEach((ev) => {
      if (!ev.hotel) return;
      if (!hotels[ev.hotel]) hotels[ev.hotel] = [];
      hotels[ev.hotel].push(ev);
    });

    if (!Object.keys(hotels).length) {
      container.innerHTML = '<div class="text-center text-muted py-4">ホテル情報がありません</div>';
      return;
    }

    container.innerHTML = Object.entries(hotels)
      .map(([hotelName, events]) => {
        const uniqueGuests = [...new Set(events.map((e) => e.employeeName))];
        const latestEvent = events.reduce((latest, cur) => (cur.endDate > latest.endDate ? cur : latest), events[0]);

        return `
          <div class="hotel-item">
            <div class="hotel-name">${this.escapeHtml(hotelName)}</div>
            <div class="hotel-guests">
              <i class="fas fa-users"></i> ${this.escapeHtml(uniqueGuests.join(", "))}
            </div>
            <div class="hotel-dates">
              <i class="fas fa-calendar"></i> 最終宿泊: ${latestEvent.endDate ? latestEvent.endDate.toLocaleDateString("ja-JP") : "-"}
            </div>
          </div>
        `;
      })
      .join("");
  }

  // navigation
  navigate(direction) {
    if (this.viewMode === "month") this.currentDate.setMonth(this.currentDate.getMonth() + direction);
    else this.currentDate.setDate(this.currentDate.getDate() + direction * 7);

    this.updateMonthDisplay();
    this.renderCalendar();
  }

  goToToday() {
    this.currentDate = new Date();
    this.updateMonthDisplay();
    this.renderCalendar();
  }

  setViewMode(mode) {
    this.viewMode = mode;
    document.querySelectorAll('[id$="View"]').forEach((btn) => btn.classList.remove("active"));
    const activeBtn = document.getElementById(mode + "View");
    if (activeBtn) activeBtn.classList.add("active");
    this.renderCalendar();
  }

  updateMonthDisplay() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth() + 1;
    const el = document.getElementById("currentMonth");
    if (el) el.textContent = `${year}年${month}月`;
  }

  // modal
  showEventModal(date = null) {
    const modalEl = document.getElementById("eventModal");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);

    // 新規
    document.getElementById("eventId").value = "";
    document.getElementById("eventModalTitle").textContent = "出張登録";
    document.getElementById("deleteEvent").style.display = "none";

    if (date) {
      const d = formatDateLocal(date);
      document.getElementById("selectedDate").value = d;
      document.getElementById("eventStartDate").value = d;
      document.getElementById("eventEndDate").value = d;
    }

    modal.show();
  }

  async editEvent(id) {
    try {
      const trip = await sbSelectOneById("business_trips", id);
      if (!trip) throw new Error("対象データが見つかりません");

      // 社員が未登録なら作る
      const emp = this.ensureEmployeeByName(trip.employee_name);

      document.getElementById("eventId").value = trip.id;
      document.getElementById("eventEmployee").value = emp ? emp.id : "";
      document.getElementById("eventDestination").value = trip.destination || "";
      document.getElementById("eventStartDate").value = (trip.start_date || "").split("T")[0];
      document.getElementById("eventEndDate").value = (trip.end_date || "").split("T")[0];
      document.getElementById("eventHotel").value = trip.hotel || "";
      document.getElementById("eventHotelCheckIn").value = trip.hotel_check_in ? String(trip.hotel_check_in).split("T")[0] : "";
      document.getElementById("eventHotelCheckOut").value = trip.hotel_check_out ? String(trip.hotel_check_out).split("T")[0] : "";
      document.getElementById("eventHotelType").value = trip.hotel_type || "";
      document.getElementById("eventNotes").value = trip.notes || "";

      document.getElementById("eventModalTitle").textContent = "出張編集";
      document.getElementById("deleteEvent").style.display = "inline-block";

      const modal = new bootstrap.Modal(document.getElementById("eventModal"));
      modal.show();
    } catch (e) {
      console.error("編集データの読み込みに失敗しました:", e);
      this.showAlert("編集データの読み込みに失敗しました", "danger");
    }
  }

  showEmployeeModal() {
    const modalEl = document.getElementById("employeeModal");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);

    document.getElementById("employeeName").value = "";
    document.querySelectorAll(".color-option").forEach((el) => el.classList.remove("selected"));
    const first = document.querySelector(".color-option");
    if (first) first.classList.add("selected");

    modal.show();
  }

  saveEmployee() {
    const name = (document.getElementById("employeeName").value || "").trim();
    const color = document.getElementById("selectedColor")?.value || this.colors[0];

    if (!name) {
      this.showAlert("社員名を入力してください", "warning");
      return;
    }

    // 既にいる場合は追加しない
    const exists = this.employees.some((e) => e.name === name);
    if (!exists) {
      this.employees.push({ id: "emp_" + Date.now(), name, color });
      this.saveEmployees();
      this.renderEmployeeColors();
      this.populateEmployeeSelect();
    }

    bootstrap.Modal.getInstance(document.getElementById("employeeModal"))?.hide();
    this.showAlert("社員を登録しました", "success");
  }

  validateEventForm(formData) {
    if (!formData.employee_name) {
      this.showAlert("社員を選択してください", "warning");
      return false;
    }
    if (!formData.destination) {
      this.showAlert("出張先を入力してください", "warning");
      return false;
    }
    if (!formData.start_date || !formData.end_date) {
      this.showAlert("開始日と終了日を選択してください", "warning");
      return false;
    }
    if (new Date(formData.start_date) > new Date(formData.end_date)) {
      this.showAlert("終了日は開始日より後の日付を選択してください", "warning");
      return false;
    }
    return true;
  }

  async saveEvent() {
    const employeeId = document.getElementById("eventEmployee").value;

    const formData = {
      employee_name: this.getEmployeeNameById(employeeId),
      destination: document.getElementById("eventDestination").value.trim(),
      start_date: document.getElementById("eventStartDate").value,
      end_date: document.getElementById("eventEndDate").value,
      hotel: document.getElementById("eventHotel").value.trim(),
      hotel_check_in: document.getElementById("eventHotelCheckIn").value || document.getElementById("eventStartDate").value,
      hotel_check_out: document.getElementById("eventHotelCheckOut").value || document.getElementById("eventEndDate").value,
      hotel_type: document.getElementById("eventHotelType").value || null,
      notes: document.getElementById("eventNotes").value.trim(),
    };

    if (!this.validateEventForm(formData)) return;

    // ローカル社員管理のため、社員がいなければ作っておく
    if (formData.employee_name) this.ensureEmployeeByName(formData.employee_name);

    try {
      const eventId = document.getElementById("eventId").value;

      if (eventId) {
        await sbUpdateById("business_trips", eventId, formData);
        this.showAlert("出張情報を更新しました", "success");
      } else {
        await sbInsert("business_trips", formData);
        this.showAlert("出張情報を登録しました", "success");
      }

      await this.loadBusinessTrips();
      bootstrap.Modal.getInstance(document.getElementById("eventModal"))?.hide();
    } catch (e) {
      console.error("保存エラー:", e);
      const msg = String(e.message || "");
      if (msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("jwt") || msg.toLowerCase().includes("permission")) {
        this.showAlert("保存に失敗しました（管理者ログインが必要です）", "danger");
      } else {
        this.showAlert("保存に失敗しました", "danger");
      }
    }
  }

  async deleteEvent() {
    const eventId = document.getElementById("eventId").value;
    if (!eventId) return;

    try {
      await sbDeleteById("business_trips", eventId);
      this.showAlert("出張情報を削除しました", "success");
      await this.loadBusinessTrips();
      bootstrap.Modal.getInstance(document.getElementById("eventModal"))?.hide();
    } catch (e) {
      console.error("削除エラー:", e);
      const msg = String(e.message || "");
      if (msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("jwt") || msg.toLowerCase().includes("permission")) {
        this.showAlert("削除に失敗しました（管理者ログインが必要です）", "danger");
      } else {
        this.showAlert("削除に失敗しました", "danger");
      }
    }
  }

  resetEventForm() {
    document.getElementById("eventForm")?.reset();
    const id = document.getElementById("eventId");
    if (id) id.value = "";
  }

  showAlert(message, type) {
    const alertDiv = document.createElement("div");
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = "top: 20px; right: 20px; z-index: 9999; min-width: 300px;";
    alertDiv.innerHTML = `
      ${this.escapeHtml(message)}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);

    setTimeout(() => {
      if (alertDiv.parentNode) alertDiv.parentNode.removeChild(alertDiv);
    }, 5000);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }
}

// グローバル
let businessTripCalendar;

document.addEventListener("DOMContentLoaded", function () {
  businessTripCalendar = new BusinessTripCalendar();
});
