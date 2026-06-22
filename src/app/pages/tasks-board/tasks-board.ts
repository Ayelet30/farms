import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dbTenant } from '../../services/supabaseClient.service';
import { getCurrentUserData } from '../../services/legacy-compat';
import { UiDialogService } from '../../services/ui-dialog.service';
import {
  DragDropModule,
  CdkDragDrop,
} from '@angular/cdk/drag-drop';

type TaskSourceType = 'horse_task' | 'general_task';
type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

type BoardTask = {
  source_type: TaskSourceType;
  id: string;
  title: string;
  description: string | null;
  assigned_to_uid: string | null;
  assigned_to_name?: string | null;
  horse_uid: string | null;
  horse_name?: string | null;
  due_date: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  completed_at: string | null;
  completed_by_uid: string | null;
  cancelled_at: string | null;
  cancelled_by_uid: string | null;
  cancellation_note: string | null;
  created_at: string;
  updated_at: string;
};

type StaffOption = {
  uid: string;
  name: string;
  role: string;
};

type HorseOption = {
  id: string;
  name: string;
};

type NewTaskForm = {
  taskKind: 'general' | 'horse';
  title: string;
  description: string;
  assigned_to_uid: string;
  due_date: string;
  priority: TaskPriority;
  horse_uid: string;
};

@Component({
  selector: 'app-tasks-board',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './tasks-board.html',
  styleUrls: ['./tasks-board.scss'],
})
export class TasksBoardComponent implements OnInit {
  private ui = inject(UiDialogService);

  loading = true;
  saving = false;
  error = '';
  success = '';

  currentUser: any = null;

  tasks: BoardTask[] = [];
  staff: StaffOption[] = [];
  horses: HorseOption[] = [];

  selectedTask: BoardTask | null = null;
showTaskDetailsModal = false;
showCreateTaskModal = false;

  searchText = '';
  selectedAssigneeUid = '';
  selectedSourceType: '' | TaskSourceType = '';
  selectedPriority: '' | TaskPriority = '';
  selectedDateFrom = '';
  selectedDateTo = '';


  newTask: NewTaskForm = this.emptyForm();
  columnIds = ['open', 'in_progress', 'completed'];

async onTaskDropped(event: CdkDragDrop<BoardTask[]>, newStatus: TaskStatus): Promise<void> {
  const task = event.item.data as BoardTask;

  if (!task || task.status === newStatus) return;

  await this.updateTaskStatus(task, newStatus);
}

  columns: { key: TaskStatus; label: string }[] = [
    { key: 'open', label: 'פתוח' },
    { key: 'in_progress', label: 'בטיפול' },
    { key: 'completed', label: 'בוצע' },
  ];

  async ngOnInit(): Promise<void> {
    await this.initPage();
  }

  private async initPage(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.success = '';

    try {
      this.currentUser = await getCurrentUserData();

      await Promise.all([
        this.loadStaff(),
        this.loadHorses(),
      ]);

      await this.loadTasks();
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בטעינת לוח המשימות';
    } finally {
      this.loading = false;
    }
  }

  private emptyForm(): NewTaskForm {
    return {
      taskKind: 'general',
      title: '',
      description: '',
      assigned_to_uid: '',
      due_date: '',
      priority: 'normal',
      horse_uid: '',
    };
  }

  get canSeeAllTasks(): boolean {
    const role = this.currentUser?.role || this.currentUser?.user_role;

    return ['secretary', 'manager', 'admin'].includes(role);
  }

  async loadTasks(): Promise<void> {
    this.error = '';
    this.success = '';

    const db = dbTenant();

    let query = db
      .from('v_tasks_board')
      .select('*')
      .neq('status', 'cancelled');

    if (!this.canSeeAllTasks && this.currentUser?.uid) {
      query = query.eq('assigned_to_uid', this.currentUser.uid);
    }

    if (this.selectedAssigneeUid) {
      query = query.eq('assigned_to_uid', this.selectedAssigneeUid);
    }

    if (this.selectedSourceType) {
      query = query.eq('source_type', this.selectedSourceType);
    }

    if (this.selectedPriority) {
      query = query.eq('priority', this.selectedPriority);
    }

    if (this.selectedDateFrom) {
      query = query.gte('due_date', this.selectedDateFrom);
    }

    if (this.selectedDateTo) {
      query = query.lte('due_date', this.selectedDateTo);
    }

    const { data, error } = await query
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    this.tasks = (data ?? []) as BoardTask[];
  }

  get filteredTasks(): BoardTask[] {
    const text = this.searchText.trim().toLowerCase();

    if (!text) return this.tasks;

    return this.tasks.filter(t => {
      return [
        t.title,
        t.description,
        t.assigned_to_name,
        t.horse_name,
      ]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(text));
    });
  }

  tasksByStatus(status: TaskStatus): BoardTask[] {
    return this.filteredTasks.filter(t => t.status === status);
  }

  async createTask(): Promise<void> {
    if (this.saving) return;

    this.error = '';
    this.success = '';

    const title = this.newTask.title.trim();

    if (!title) {
      this.error = 'חובה להזין כותרת למשימה';
      return;
    }

    if (!this.newTask.assigned_to_uid) {
      this.error = 'חובה לבחור למי המשימה משויכת';
      return;
    }

    if (this.newTask.taskKind === 'horse' && !this.newTask.horse_uid) {
      this.error = 'במשימת סוס חובה לבחור סוס';
      return;
    }

    this.saving = true;

    try {
      const db = dbTenant();
      const user = await getCurrentUserData();

      if (this.newTask.taskKind === 'general') {
        const { error } = await db
          .from('general_tasks')
          .insert({
            title,
            description: this.newTask.description.trim() || null,
            assigned_to_uid: this.newTask.assigned_to_uid,
            due_date: this.newTask.due_date || null,
            priority: this.newTask.priority,
            status: 'open',
            created_by_uid: user?.uid ?? null,
          });

        if (error) throw error;
      } else {
        const horse = this.horses.find(h => h.id === this.newTask.horse_uid);

        const { error } = await db
          .from('rider_service_tasks')
          .insert({
            rider_service_id: null,
            rider_uid: this.newTask.assigned_to_uid,
            horse_uid: this.newTask.horse_uid,
            service_type_id: null,
            service_name: title,
            due_date: this.newTask.due_date || this.todayYmd(),
            status: 'open',
            notes: this.newTask.description.trim() || null,
          });

        if (error) throw error;
      }

      this.newTask = this.emptyForm();
      this.showCreateTaskModal = false;

      await this.loadTasks();

      this.success = 'המשימה נוצרה בהצלחה';
    } catch (e: any) {
      this.error = e?.message || 'שגיאה ביצירת המשימה';
    } finally {
      this.saving = false;
    }
  }

  async updateTaskStatus(task: BoardTask, status: TaskStatus): Promise<void> {
    if (status === 'cancelled') {
      await this.cancelTask(task);
      return;
    }

    this.error = '';
    this.success = '';

    try {
      const db = dbTenant();
      const user = await getCurrentUserData();
      const now = new Date().toISOString();

      const table =
        task.source_type === 'horse_task'
          ? 'rider_service_tasks'
          : 'general_tasks';

      const payload: any = {
        status,
        updated_at: now,
      };

      if (status === 'completed') {
        payload.completed_at = now;
        payload.completed_by_uid = user?.uid ?? null;
      }

      const { error } = await db
        .from(table)
        .update(payload)
        .eq('id', task.id);

      if (error) throw error;

      await this.loadTasks();

      this.success = 'סטטוס המשימה עודכן';
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בעדכון המשימה';
    }
  }

  async cancelTask(task: BoardTask): Promise<void> {
    const ok = await this.ui.confirm({
      title: 'ביטול משימה',
      message: `לבטל את המשימה "${task.title}"?`,
      okText: 'כן, לבטל',
      cancelText: 'חזרה',
      showCancel: true,
    });

    if (!ok) return;

    try {
      const db = dbTenant();
      const user = await getCurrentUserData();
      const now = new Date().toISOString();

      const table =
        task.source_type === 'horse_task'
          ? 'rider_service_tasks'
          : 'general_tasks';

      const { error } = await db
        .from(table)
        .update({
          status: 'cancelled',
          cancelled_at: now,
          cancelled_by_uid: user?.uid ?? null,
          cancellation_note: 'בוטל מלוח המשימות',
          updated_at: now,
        })
        .eq('id', task.id);

      if (error) throw error;

      await this.loadTasks();

      this.success = 'המשימה בוטלה';
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בביטול המשימה';
    }
  }

  async saveInlineTask(task: BoardTask): Promise<void> {
    try {
      const db = dbTenant();

      const table =
        task.source_type === 'horse_task'
          ? 'rider_service_tasks'
          : 'general_tasks';

      const payload =
        task.source_type === 'horse_task'
          ? {
              service_name: task.title,
              notes: task.description,
              due_date: task.due_date,
              updated_at: new Date().toISOString(),
            }
          : {
              title: task.title,
              description: task.description,
              due_date: task.due_date,
              priority: task.priority,
              assigned_to_uid: task.assigned_to_uid,
              updated_at: new Date().toISOString(),
            };

      const { error } = await db
        .from(table)
        .update(payload)
        .eq('id', task.id);

      if (error) throw error;

      await this.loadTasks();

      this.success = 'המשימה נשמרה';
    } catch (e: any) {
      this.error = e?.message || 'שגיאה בשמירת המשימה';
    }
  }
  openCreateTaskModal(): void {
  this.newTask = this.emptyForm();
  this.showCreateTaskModal = true;
}

closeCreateTaskModal(): void {
  this.showCreateTaskModal = false;
}

openTaskDetails(task: BoardTask): void {
  this.selectedTask = structuredClone(task);
  this.showTaskDetailsModal = true;
}

closeTaskDetails(): void {
  this.selectedTask = null;
  this.showTaskDetailsModal = false;
}

async saveSelectedTask(): Promise<void> {
  if (!this.selectedTask) return;

  await this.saveInlineTask(this.selectedTask);

  this.closeTaskDetails();
}

async completeSelectedTask(): Promise<void> {
  if (!this.selectedTask) return;

  await this.updateTaskStatus(
    this.selectedTask,
    'completed'
  );

  this.closeTaskDetails();
}

async moveSelectedTaskToProgress(): Promise<void> {
  if (!this.selectedTask) return;

  await this.updateTaskStatus(
    this.selectedTask,
    'in_progress'
  );

  this.closeTaskDetails();
}

async cancelSelectedTask(): Promise<void> {
  if (!this.selectedTask) return;

  await this.cancelTask(this.selectedTask);

  this.closeTaskDetails();
}

dateTimeText(value: string | null): string {
  if (!value) return '—';

  return new Date(value).toLocaleString('he-IL');
}

  private async loadStaff(): Promise<void> {
    const db = dbTenant();

    const staff: StaffOption[] = [];

    const { data: instructors } = await db
      .from('instructors')
      .select('uid, id_number, first_name, last_name, full_name')
      .order('first_name', { ascending: true });

    for (const i of instructors ?? []) {
      const uid = i.uid || i.id_number;
      if (!uid) continue;

      staff.push({
        uid,
        name:
          i.full_name ||
          `${i.first_name || ''} ${i.last_name || ''}`.trim() ||
          uid,
        role: 'מדריך',
      });
    }

    const { data: riders } = await db
      .from('independent_riders')
      .select('uid, first_name, last_name, full_name, is_farm_responsible, status')
      .eq('status', 'active')
      .order('first_name', { ascending: true });

    for (const r of riders ?? []) {
      if (!r.uid) continue;

      staff.push({
        uid: r.uid,
        name:
          r.full_name ||
          `${r.first_name || ''} ${r.last_name || ''}`.trim() ||
          r.uid,
        role: r.is_farm_responsible ? 'איש חווה' : 'רוכב עצמאי',
      });
    }

    const map = new Map<string, StaffOption>();

    for (const item of staff) {
      if (!map.has(item.uid)) {
        map.set(item.uid, item);
      }
    }

    this.staff = Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'he')
    );
  }

  private async loadHorses(): Promise<void> {
    const { data, error } = await dbTenant()
      .from('horses')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;

    this.horses = data ?? [];
  }

  clearFilters(): void {
    this.searchText = '';
    this.selectedAssigneeUid = '';
    this.selectedSourceType = '';
    this.selectedPriority = '';
    this.selectedDateFrom = '';
    this.selectedDateTo = '';
    this.loadTasks();
  }

  assignedName(uid: string | null | undefined): string {
    if (!uid) return 'לא משויך';
    return this.staff.find(s => s.uid === uid)?.name || uid;
  }

  horseName(id: string | null | undefined): string {
    if (!id) return '';
    return this.horses.find(h => h.id === id)?.name || '';
  }

  sourceLabel(type: TaskSourceType): string {
    return type === 'horse_task' ? 'משימת סוס' : 'משימה כללית';
  }

  priorityLabel(priority: TaskPriority): string {
    switch (priority) {
      case 'low': return 'נמוכה';
      case 'normal': return 'רגילה';
      case 'high': return 'גבוהה';
      case 'urgent': return 'דחופה';
      default: return priority;
    }
  }

  statusLabel(status: TaskStatus): string {
    switch (status) {
      case 'open': return 'פתוח';
      case 'in_progress': return 'בטיפול';
      case 'completed': return 'בוצע';
      case 'cancelled': return 'בוטל';
      default: return status;
    }
  }

  isOverdue(task: BoardTask): boolean {
    if (task.status !== 'open' && task.status !== 'in_progress') return false;
    if (!task.due_date) return false;

    return task.due_date < this.todayYmd();
  }

  isDueToday(task: BoardTask): boolean {
    return !!task.due_date && task.due_date === this.todayYmd();
  }

  taskClass(task: BoardTask): string {
    if (this.isOverdue(task)) return 'overdue';
    if (this.isDueToday(task)) return 'today';
    if (task.priority === 'urgent') return 'urgent';
    if (task.priority === 'high') return 'high';
    return '';
  }

  private todayYmd(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    return `${y}-${m}-${day}`;
  }
}