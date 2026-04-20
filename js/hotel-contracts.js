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
        this.currentRegion = '札幌';
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
        document.getElementById('regionFilter')?.addEventListener('change', (e) => {
            this.currentRegion = e.target.value || '札幌';
            this.renderHotelCalendar();
            this.renderHotelContractsList();
        });

        const modal = document.getElementById('hotelContractModal');
        modal?.addEventListener('hidden.bs.modal', () => this.resetHotelContractForm());

        // 一覧の「編集」「削除」ボタン
        const list = document.getElementById('hotelContractsList');
        list?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const action = btn.getAttribute('data-action');
            const id = btn.getAttribute('data-id');
            if (!id) return;

            if (action === 'edit') {
                this.showHotelContractModal(id);
            } else if (action === 'delete') {
                this.confirmAndDeleteContract(id);
            }
        });
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

        this.hotelContracts = (data || []).map(c => ({
            id: c.id,
            hotelName: c.hotel_name,
            hotelType: c.hotel_type,
            region: c.region || '札幌',
            contractStartDate: new Date(c.contract_start_date),
            contractEndDate: new Date(c.contract_end_date),
            paymentStatus: c.payment_status,
            // ★修正：DBのnotesを保持（消える原因を潰す）
            notes: c.notes || ""
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
            region: document.getElementById('hotelRegion')?.value || this.currentRegion,
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

        if (error && this.isMissingRegionColumnError(error)) {
            const fallbackPayload = { ...payload };
            delete fallbackPayload.region;
            if (id) {
                ({ error } = await supabaseClient
                    .from('hotel_contracts')
                    .update(fallbackPayload)
                    .eq('id', id));
            } else {
                ({ error } = await supabaseClient
                    .from('hotel_contracts')
                    .insert(fallbackPayload));
            }
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
    async confirmAndDeleteContract(id) {
        const c = this.hotelContracts.find(x => x.id === id);
        const name = c ? c.hotelName : '';
        const ok = window.confirm(`${name ? name + ' を' : ''}削除しますか？`);
        if (!ok) return;

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
        await this.loadHotelContracts();
    }

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

        const contracts = this.getFilteredHotelContracts();

        if (contracts.length === 0) {
            container.innerHTML = '<div class="text-muted">この地域の契約中ホテルはありません</div>';
            return;
        }

        // ★修正：支払いステータスと備考を一覧に表示
        container.innerHTML = contracts.map(c => `
            <div class="hotel-contract-item">
                <div class="contract-header">
                    <div class="contract-name">
                        ${this.escapeHtml(c.hotelName)}
                    </div>
                    <div class="contract-actions">
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-action="edit" data-id="${c.id}">
                            <i class="fas fa-edit"></i> 編集
                        </button>
                        <button type="button" class="btn btn-outline-danger btn-sm" data-action="delete" data-id="${c.id}">
                            <i class="fas fa-trash"></i> 削除
                        </button>
                    </div>
                </div>

                <div class="contract-dates">
                    ${c.contractStartDate.toLocaleDateString()} ～ ${c.contractEndDate.toLocaleDateString()}
                </div>

                ${c.hotelType ? `<div class="contract-payment text-muted">種類: ${this.escapeHtml(c.hotelType)}</div>` : ``}

                <div class="contract-payment text-muted">
                    地域: ${this.escapeHtml(c.region)}
                </div>

                <div class="contract-payment">
                    支払いステータス: ${this.escapeHtml(c.paymentStatus || "-")}
                </div>

                ${c.notes ? `<div class="contract-payment text-muted">備考: ${this.escapeHtml(c.notes)}</div>` : ``}
            </div>
        `).join('');
    }

    showHotelContractModal(id = null) {
        if (id) {
            const c = this.hotelContracts.find(x => x.id === id);
            if (!c) return;

            document.getElementById('hotelContractId').value = c.id;
            document.getElementById('hotelName').value = c.hotelName;
            document.getElementById('hotelRegion').value = c.region || this.currentRegion;
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
        const region = document.getElementById('hotelRegion');
        if (region) region.value = this.currentRegion;
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

    getFilteredHotelContracts() {
        return this.hotelContracts.filter(c => (c.region || '札幌') === this.currentRegion);
    }

    isMissingRegionColumnError(error) {
        const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`;
        return message.includes('region') && (
            message.includes('column') ||
            message.includes('schema cache') ||
            message.includes('Could not find')
        );
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
