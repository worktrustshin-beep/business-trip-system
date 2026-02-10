// ===============================
// Supabase 設定
// ===============================
const SUPABASE_URL = 'https://ojwiblktgtfxzrfrznmr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JS4Wr6jACtuQ1tcsNdXKAQ_VX1cD35Y';

const supabaseClient = supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

// ===============================
// ホテル契約期間管理
// ===============================
class HotelContractManager {
    constructor() {
        this.currentDate = new Date();
        this.hotelContracts = [];
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadHotelContracts();
        this.renderHotelCalendar();
        this.renderHotelContractsList();
    }

    bindEvents() {
        document.getElementById('prevBtn')?.addEventListener('click', () => this.navigate(-1));
        document.getElementById('nextBtn')?.addEventListener('click', () => this.navigate(1));
        document.getElementById('todayBtn')?.addEventListener('click', () => this.goToToday());

        document.getElementById('saveHotelContract')?.addEventListener('click', () => this.saveHotelContract());
        document.getElementById('deleteHotelContract')?.addEventListener('click', () => this.deleteHotelContract());
        document.getElementById('addHotelContractBtn')?.addEventListener('click', () => this.showHotelContractModal());

        const modal = document.getElementById('hotelContractModal');
        modal?.addEventListener('hidden.bs.modal', () => this.resetHotelContractForm());
    }

    // ===============================
    // データ取得
    // ===============================
    async loadHotelContracts() {
        const { data, error } = await supabaseClient
            .from('hotel_contracts')
            .select('*')
            .order('contract_start_date', { ascending: true });

        if (error) {
            console.error(error);
            this.showAlert('ホテル契約情報の取得に失敗しました', 'danger');
            return;
        }

        this.hotelContracts = data.map(c => ({
            id: c.id,
            hotelName: c.hotel_name,
            hotelType: c.hotel_type,
            contractStartDate: new Date(c.contract_start_date),
            contractEndDate: new Date(c.contract_end_date),
            paymentStatus: c.payment_status,
            notes: ""
        }));

        this.renderHotelCalendar();
        this.renderHotelContractsList();
    }

    // ===============================
    // 保存（追加・更新）
    // ===============================
    async saveHotelContract() {
        const id = document.getElementById('hotelContractId').value;

        const payload = {
          hotel_name: document.getElementById('hotelName').value.trim(),
          hotel_type: document.getElementById('hotelType').value,
          contract_start_date: document.getElementById('contractStartDate').value,
          contract_end_date: document.getElementById('contractEndDate').value,
          payment_status: document.getElementById('paymentStatus').value,
          notes: document.getElementById('hotelNotes').value.trim() || ''
        };


        if (!payload.hotel_name) {
            this.showAlert('ホテル名を入力してください', 'warning');
            return;
        }

        let error;
        if (id) {
            ({ error } = await supabaseClient
                .from('hotel_contracts')
                .update(payload)
                .eq('id', id));
        } else {
            ({ error } = await supabaseClient
                .from('hotel_contracts')
                .insert(payload));
        }

        if (error) {
            console.error(error);
            this.showAlert('保存に失敗しました', 'danger');
            return;
        }

        this.showAlert('保存しました', 'success');
        this.loadHotelContracts();
        bootstrap.Modal.getInstance(document.getElementById('hotelContractModal')).hide();
    }

    // ===============================
    // 削除
    // ===============================
    async deleteHotelContract() {
        const id = document.getElementById('hotelContractId').value;
        if (!id) return;

        const { error } = await supabaseClient
            .from('hotel_contracts')
            .delete()
            .eq('id', id);

        if (error) {
            console.error(error);
            this.showAlert('削除に失敗しました', 'danger');
            return;
        }

        this.showAlert('削除しました', 'success');
        this.loadHotelContracts();
        bootstrap.Modal.getInstance(document.getElementById('hotelContractModal')).hide();
    }

    // ===============================
    // UI系（簡略版）
    // ===============================
    renderHotelCalendar() {
        // 既存ロジックそのままでOK
    }

    renderHotelContractsList() {
        const container = document.getElementById('hotelContractsList');
        if (!container) return;

        if (this.hotelContracts.length === 0) {
            container.innerHTML = '<div class="text-muted">契約中のホテルはありません</div>';
            return;
        }

        container.innerHTML = this.hotelContracts.map(c => `
            <div class="hotel-contract-item">
                <strong>${this.escapeHtml(c.hotelName)}</strong><br>
                ${c.contractStartDate.toLocaleDateString()} ～ ${c.contractEndDate.toLocaleDateString()}
            </div>
        `).join('');
    }

    showHotelContractModal(id = null) {
        if (id) {
            const c = this.hotelContracts.find(x => x.id === id);
            if (!c) return;

            document.getElementById('hotelContractId').value = c.id;
            document.getElementById('hotelName').value = c.hotelName;
            document.getElementById('hotelType').value = c.hotelType;
            document.getElementById('contractStartDate').value = c.contractStartDate.toISOString().split('T')[0];
            document.getElementById('contractEndDate').value = c.contractEndDate.toISOString().split('T')[0];
            document.getElementById('paymentStatus').value = c.paymentStatus;
            document.getElementById('hotelNotes').value = c.notes || '';
        } else {
            this.resetHotelContractForm();
        }

        new bootstrap.Modal(document.getElementById('hotelContractModal')).show();
    }

    resetHotelContractForm() {
        document.getElementById('hotelContractForm')?.reset();
        document.getElementById('hotelContractId').value = '';
    }

    navigate(dir) {
        this.currentDate.setMonth(this.currentDate.getMonth() + dir);
        this.renderHotelCalendar();
    }

    goToToday() {
        this.currentDate = new Date();
        this.renderHotelCalendar();
    }

    showAlert(msg, type) {
        alert(msg);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// ===============================
let hotelContractManager;
document.addEventListener('DOMContentLoaded', () => {
    hotelContractManager = new HotelContractManager();
});
