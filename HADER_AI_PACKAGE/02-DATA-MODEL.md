# HADER AI PACKAGE - نموذج البيانات

## 02-DATA-MODEL.md

### Enums & Constants
*   **Roles:** `site_admin`, `school_admin`, `supervisor_global`, `supervisor_class`, `watcher`, `kiosk`, `guardian`.
*   **Attendance Status:** `present`, `absent`, `late`, `excused`.
*   **Storage Keys:** معرفات ثابتة لتخزين البيانات محلياً (مثل `hader:students`, `hader:attendance`).

### الكيانات الأساسية (Entities)

#### 1. Student (الطالب)
*   `id`: UUID (Primary Key)
*   `name`: String (Required)
*   `class_name`: String (Refers to Grade/Level)
*   `section`: String (Refers to Class Section)
*   `whatsapp_phone`: String (Optional)
*   `guardian_phone`: String (Optional - Critical for notifications)
*   `guardian_name`: String
*   `is_active`: Boolean

#### 2. User (المستخدم)
*   `id`: UUID
*   `username`: String (Unique)
*   `role`: Role Enum
*   `assigned_classes`: Array of Objects (For supervisors to access specific classes)
*   `can_use_whatsapp`: Boolean

#### 3. AttendanceRecord (سجل الحضور)
*   `id`: UUID
*   `student_id`: UUID (Foreign Key -> Student)
*   `date`: Date String (YYYY-MM-DD)
*   `status`: Enum (present, absent, late)
*   `timestamp`: ISO DateTime
*   `minutes_late`: Integer
*   `recorded_by`: User ID / Device ID
*   `sync_status`: Enum (synced, pending, error) - *Local driven*

#### 4. ExitPermission (تصريح خروج)
*   `id`: UUID
*   `student_id`: UUID
*   `reason`: String
*   `exit_time`: DateTime
*   `expected_return`: DateTime
*   `actual_return`: DateTime (Nullable)
*   `status`: Enum (active, completed, overdue)

#### 5. NotificationLog (سجل الإشعارات)
*   `id`: UUID
*   `type`: Enum (whatsapp, telegram)
*   `recipient`: String (Phone/ChatID)
*   `status`: Enum (sent, failed, delivered)
*   `content`: Text
*   `related_entity_id`: UUID (Student or Attendance ID)

### العلاقات (Relationships)
*   **Student -> Attendance:** One-to-Many (طالب له سجلات حضور متعددة).
*   **User -> SchoolClass:** Many-to-Many (عبر `assigned_classes`).
*   **Student -> ExitPermission:** One-to-Many.

### القيود (Constraints)
*   سجل حضور واحد للطالب في اليوم الواحد (يجب التحقق منه قبل الإدخال).
*   رقم ولي الأمر يجب أن يكون بصيغة دولية صحيحة لإرسال الواتساب.
*   حذف الطالب لا يحذف سجلات الحضور التاريخية (Soft Delete preferred).
