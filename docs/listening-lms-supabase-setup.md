# 精听 LMS Supabase 部署说明

## 1. 创建 Supabase 项目

1. 在 Supabase 创建项目。
2. 打开 SQL Editor，完整运行 `supabase/listening_lms_schema.sql`。
3. 在 Authentication > Providers 中启用 Email/Password。
4. 在 Authentication > URL Configuration 中设置：
   - Site URL: `https://terrywaio.github.io/listening_lab_course_confirmed/`
   - Redirect URLs: `https://terrywaio.github.io/listening_lab_course_confirmed/**`

## 2. 配置前端 anon key

在部署仓库根目录复制 `supabase-config.example.js` 为 `supabase-config.js`。如果你在源码目录改，则对应文件是 `listening_lab/supabase-config.example.js` 和 `listening_lab/supabase-config.js`。填入：

```js
window.LISTENING_LAB_SUPABASE = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

GitHub Pages 是纯静态部署，所以前端只能使用 anon key。不要把 service role key 放进任何前端文件或 GitHub Pages 仓库。

## 3. 创建第一个老师账号

1. 在网站注册一个账号。
2. 回到 Supabase SQL Editor，把这个账号改成老师：

```sql
update public.profiles
set role = 'teacher'
where email = 'teacher@example.com';
```

后续学生自己注册即可，默认都是 `student`。老师登录后可以看到学生列表、分配课包、查看完成率、听了几次、答案、分数和提交时间。

## 4. 内容结构

当前版本仍使用静态 `library.json` 和 `lessons/**/lesson.json`。老师分配任务时只保存：

- `lesson_path`
- `lesson_title`
- `lesson_segment_count`
- `source_type = static_lesson`
- `content_ref` JSON

以后加入 sentence item、老师人工校对、校对状态时，可以在 `source_type` 和 `content_ref` 上扩展，不需要推翻作业和进度表。

## 5. 权限边界

- 学生只能读取自己的 assignments 和 progress。
- 学生只能写自己的 assignment_progress / segment_progress。
- 老师只能创建和管理自己分配的 assignments。
- 老师能读取自己任务下的学生进度。
- 老师角色必须由 Supabase 后台或 SQL 设置，前端注册不会创建老师。

参考文档：

- Supabase JavaScript Auth: https://supabase.com/docs/reference/javascript/auth-signinwithpassword
- Supabase 用户资料触发器: https://supabase.com/docs/guides/auth/managing-user-data
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
