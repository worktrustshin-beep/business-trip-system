// 出張管理システム JavaScript (Supabase対応版)

// 1) ここだけあなたの値に差し替え
const SUPABASE_URL = "https://ojwiblktgtfxzrfrznmr.supabase.co"; // Data API の Project URL
const SUPABASE_ANON_KEY = "sb_publishable_JS4Wr6jACtuQ1tcsNdXKAQ_VX1cD35Y"; // Publishable key（sb_publishable_〜）

// 2) トークン保存先（管理者ログイン後に保存される）
const SB_TOKEN_KEY = "sb_access_token";

// 3) 共通ヘッダ
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

// 4) Supabase REST (PostgREST) 呼び出しユーティリティ
async function sbRequest(path, options = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, options);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  const ct = res.headers.get("content-type") || "";
  const hasJson = ct.includes("application/json");
  if (!hasJson) return null;

  return await res.json();
}

function encodeILike(value) {
  // ilike 用のワイルドカード
  return `*${value}*`;
}

// 5) 認証（管理者のみ）
// Email/Password でログインする場合に使用します。
// 既に別UIでログインを実装している場合はこの関数を使わなくても閲覧はできます（編集は不可）。
async function sbLoginWithPassword(email, password) {
  const body = new URLSearchParams();
  body.set("grant_type", "password");
  body.set("email", email);
  body.set("password", password);

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "ログインに失敗しました");
  }

  const data = await res.json();
  sessionStorage.setItem(SB_TOKEN_KEY, data.access_token);
  return data;
}

function sbLogout() {
  sessionStorage.removeItem(SB_TOKEN_KEY);
}

// 6) CRUD ラッパ
async function sbSelect(table, queryString) {
  return await sbRequest(`/rest/v1/${table}?select=*${queryString}`, {
    method: "GET",
    headers: sbHeaders(false), // SELECT は全員許可の前提（RLSでselect true）
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
  // RLSで insert/update/delete は管理者のみ
  return await sbRequest(`/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...sbHeaders(true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
}

async function sbUpdateById(table, id, payload) {
  return await sbRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...sbHeaders(true),
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
}

async function sbDeleteById(table, id) {
  return await sbRequest(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: sbHeaders(true),
  });
}

// 出張管理クラス
class BusinessTripManager {
  constructor() {
    this.currentEditId = null;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadBusinessTrips();
    this.setDefaultDates();
  }

  bindEvents() {
    document.getElementById("addBusinessTripBtn")?.addEventListener("click", () => this.showAddModal());
    document.getElementById("saveBusinessTrip")?.addEventListener("click", () => this.saveBusinessTrip());
    document.getElementById("searchBtn")?.addEventListener("click", () => this.searchBusinessTrips());
    document.getElementById("clearBtn")?.addEventListener("click", () => this.clearSearch());
    document.getElementById("confirmDelete")?.addEventListener("click", () => this.confirmDelete());

    // モーダルイベント
    const businessTripModal = document.getElementById("businessTripModal");
    businessTripModal?.addEventListener("hidden.bs.modal", () => this.resetForm());

    // フォームの日付制限
    document.getElementById("startDate")?.addEventListener("change", () => this.updateEndDateMin());

    // 任意：ログインUIがある場合だけ有効化（無くても動く）
    // 例：loginEmail, loginPassword, loginBtn, logoutBtn がHTMLにある場合
    document.getElementById("loginBtn")?.addEventListener("click", async () => {
      const email = (document.getElementById("loginEmail")?.value || "").trim();
      const password = document.getElementById("loginPassword")?.value || "";
      if (!email || !password) {
        this.showAlert("メールアドレスとパスワードを入力してください", "warning");
        return;
      }
      try {
        await sbLoginWithPassword(email, password);
        this.showAlert("ログインしました", "success");
      } catch (e) {
        console.error(e);
        this.showAlert("ログインに失敗しました", "danger");
      }
    });

    document.getElementById("logoutBtn")?.addEventListener("click", () => {
      sbLogout();
      this.showAlert("ログアウトしました", "success");
    });
  }

  setDefaultDates() {
    const today = new Date().toISOString().split("T")[0];
    const el = document.getElementById("searchDate");
    if (el) el.value = today;
  }

  updateEndDateMin() {
    const startDate = document.getElementById("startDate")?.value;
    const endDateInput = document.getElementById("endDate");
    if (startDate && endDateInput) {
      endDateInput.min = startDate;
      if (endDateInput.value && endDateInput.value < startDate) {
        endDateInput.value = startDate;
      }
    }
  }

  async loadBusinessTrips() {
    try {
      // order と limit を Supabase形式に変更
      const rows = await sbSelect("business_trips", "&order=start_date.asc&limit=100");
      this.displayBusinessTrips(rows);
    } catch (error) {
      console.error("データの読み込みに失敗しました:", error);
      this.showAlert("データの読み込みに失敗しました", "danger");
    }
  }

  displayBusinessTrips(trips) {
    const tbody = document.getElementById("businessTripTableBody");
    const noDataMessage = document.getElementById("noDataMessage");

    if (!tbody || !noDataMessage) return;

    if (!trips || trips.length === 0) {
      tbody.innerHTML = "";
      noDataMessage.style.display = "block";
      return;
    }

    noDataMessage.style.display = "none";
    tbody.innerHTML = trips.map((trip) => this.createTripRow(trip)).join("");
  }

  createTripRow(trip) {
    const startDate = trip.start_date ? new Date(trip.start_date).toLocaleDateString("ja-JP") : "-";
    const endDate = trip.end_date ? new Date(trip.end_date).toLocaleDateString("ja-JP") : "-";

    return `
      <tr>
        <td>${this.escapeHtml(trip.employee_name)}</td>
        <td>${this.escapeHtml(trip.destination)}</td>
        <td>${startDate}</td>
        <td>${endDate}</td>
        <td>${this.escapeHtml(trip.hotel || "-")}</td>
        <td>${this.escapeHtml(trip.notes || "-")}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="businessTripManager.editBusinessTrip('${trip.id}')">
              <i class="fas fa-edit"></i>
            </button>
            <button class="btn btn-outline-danger" onclick="businessTripManager.showDeleteConfirm('${trip.id}', '${this.escapeHtml(trip.employee_name)}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  showAddModal() {
    this.currentEditId = null;
    const title = document.getElementById("modalTitle");
    if (title) title.textContent = "出張登録";
    const modalEl = document.getElementById("businessTripModal");
    if (!modalEl) return;
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
  }

  async editBusinessTrip(id) {
    try {
      const trip = await sbSelectOneById("business_trips", id);
      if (!trip) throw new Error("対象データが見つかりません");

      this.currentEditId = id;
      const title = document.getElementById("modalTitle");
      if (title) title.textContent = "出張編集";

      document.getElementById("tripId").value = trip.id;
      document.getElementById("employeeName").value = trip.employee_name || "";
      document.getElementById("destination").value = trip.destination || "";
      document.getElementById("startDate").value = (trip.start_date || "").split("T")[0];
      document.getElementById("endDate").value = (trip.end_date || "").split("T")[0];
      document.getElementById("hotel").value = trip.hotel || "";
      document.getElementById("notes").value = trip.notes || "";

      const modalEl = document.getElementById("businessTripModal");
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    } catch (error) {
      console.error("データの読み込みに失敗しました:", error);
      this.showAlert("データの読み込みに失敗しました", "danger");
    }
  }

  async saveBusinessTrip() {
    const formData = this.getFormData();

    if (!this.validateForm(formData)) return;

    try {
      // RLSにより、管理者ログイン（tokenあり）でないと失敗します
      if (this.currentEditId) {
        await sbUpdateById("business_trips", this.currentEditId, formData);
        this.showAlert("出張情報を更新しました", "success");
      } else {
        await sbInsert("business_trips", formData);
        this.showAlert("出張情報を登録しました", "success");
      }

      await this.loadBusinessTrips();
      bootstrap.Modal.getInstance(document.getElementById("businessTripModal"))?.hide();
    } catch (error) {
      console.error("保存エラー:", error);

      // ありがちなケース：未ログインで編集しようとした
      const msg = String(error.message || "");
      if (msg.includes("permission") || msg.includes("JWT") || msg.includes("not allowed") || msg.includes("401") || msg.includes("403")) {
        this.showAlert("保存に失敗しました（管理者ログインが必要です）", "danger");
      } else {
        this.showAlert("保存に失敗しました", "danger");
      }
    }
  }

  getFormData() {
      return {
          employee_name: document.getElementById('employeeName').value.trim(),
          destination: document.getElementById('destination').value.trim(),
          start_date: document.getElementById('startDate').value,
          end_date: document.getElementById('endDate').value,
          // DB側でNOT NULLのため、ひとまず出張期間＝宿泊期間として保存
          hotel_check_in: document.getElementById('startDate').value,
          hotel_check_out: document.getElementById('endDate').value,
          hotel: document.getElementById('hotel').value.trim(),
          hotel_type: document.getElementById('hotel').value.trim(),
          notes: document.getElementById('notes').value.trim()
      };
}


  validateForm(data) {
    if (!data.employee_name) {
      this.showAlert("社員名を入力してください", "warning");
      return false;
    }
    if (!data.destination) {
      this.showAlert("出張先を入力してください", "warning");
      return false;
    }
    if (!data.start_date) {
      this.showAlert("開始日を選択してください", "warning");
      return false;
    }
    if (!data.end_date) {
      this.showAlert("終了日を選択してください", "warning");
      return false;
    }
    if (new Date(data.start_date) > new Date(data.end_date)) {
      this.showAlert("終了日は開始日より後の日付を選択してください", "warning");
      return false;
    }
    return true;
  }

  showDeleteConfirm(id, employeeName) {
  this.currentEditId = id;
  const modalEl = document.getElementById("confirmDeleteModal");
  if (!modalEl) return;
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
}

  async confirmDelete() {
    try {
      await sbDeleteById("business_trips", this.currentEditId);
      this.showAlert("出張情報を削除しました", "success");
      await this.loadBusinessTrips();
      bootstrap.Modal.getInstance(document.getElementById("confirmDeleteModal"))?.hide();
    } catch (error) {
      console.error("削除エラー:", error);
      const msg = String(error.message || "");
      if (msg.includes("permission") || msg.includes("JWT") || msg.includes("401") || msg.includes("403")) {
        this.showAlert("削除に失敗しました（管理者ログインが必要です）", "danger");
      } else {
        this.showAlert("削除に失敗しました", "danger");
      }
    }
  }

  async searchBusinessTrips() {
  const searchDate = document.getElementById("searchDate")?.value;
  const searchEmployee = document.getElementById("employeeNameSearch")?.value.trim();
  const searchLocation = document.getElementById("destinationSearch")?.value.trim();

  let query = "&order=start_date.asc&limit=100";

  if (searchDate) {
    const d = encodeURIComponent(searchDate);
    query += `&start_date=lte.${d}&end_date=gte.${d}`;
  }
  if (searchEmployee) {
    query += `&employee_name=ilike.${encodeURIComponent(encodeILike(searchEmployee))}`;
  }
  if (searchLocation) {
    query += `&destination=ilike.${encodeURIComponent(encodeILike(searchLocation))}`;
  }

  try {
    const rows = await sbSelect("business_trips", query);
    this.displayBusinessTrips(rows);
  } catch (error) {
    console.error("検索エラー:", error);
    this.showAlert("検索に失敗しました", "danger");
  }
}

clearSearch() {
  const d = document.getElementById("searchDate");
  const e = document.getElementById("employeeNameSearch");
  const l = document.getElementById("destinationSearch");
  if (d) d.value = "";
  if (e) e.value = "";
  if (l) l.value = "";
  this.loadBusinessTrips();
}


  resetForm() {
    document.getElementById("businessTripForm")?.reset();
    this.currentEditId = null;
  }

  showAlert(message, type) {
    const alertDiv = document.createElement("div");
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
    alertDiv.style.cssText = "top: 20px; right: 20px; z-index: 9999; min-width: 300px;";
    alertDiv.innerHTML = `
      ${message}
      <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(alertDiv);

    setTimeout(() => {
      if (alertDiv.parentNode) {
        alertDiv.parentNode.removeChild(alertDiv);
      }
    }, 5000);
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }
}

let businessTripManager;

document.addEventListener("DOMContentLoaded", function () {
  businessTripManager = new BusinessTripManager();
});
