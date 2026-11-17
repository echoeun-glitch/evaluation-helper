# 평가 입력기

전담교사용 평가 의견 입력 웹앱 — https://echoeun-glitch.github.io/evaluation-helper/

- 영역별 주요 활동·평가 기준 입력 → 최상·상·중·하 의견 8개씩
- 학생별로 척도를 고르면 영역별 문장을 조합해 복사 (같은 척도끼리 문장 중복 최소화)
- 학년·과목별로 따로 저장 (학년이나 과목을 바꾸면 그 학년·과목 내용으로 바뀜), 글자 수·바이트 표시

## 입장 코드

처음 열면 입장 코드를 묻습니다. 맞는 코드를 넣으면 그 기기(브라우저)에 기억해 두고, 다음부터는 묻지 않습니다. 화면 위 «잠그기»를 누르면 그 기기에서 코드를 지우고 다시 잠급니다.

- 코드는 페이지에 들어 있지 않고 Firebase 금고(Secret Manager)의 `ACCESS_CODE`에만 있으며, 의견 생성 서버가 확인합니다. 코드를 모르면 화면에 들어올 수 없고 AI 의견 생성도 쓸 수 없습니다.
- 앞뒤 공백과 영문 대소문자는 구분하지 않습니다.
- 같은 곳(IP)에서 하루에 20번 넘게 틀리면 그날은 막힙니다.
- 코드를 바꾸면 이미 들어와 있던 기기도 다음에 열 때(또는 의견 생성 때) 다시 묻습니다.
- 페이지 자체는 GitHub Pages의 공개 파일이라, 개발 도구로 HTML을 열어 보는 것까지 막지는 못합니다. 학생 정보는 페이지가 아니라 각자 브라우저에만 저장되고, 비용이 드는 AI 생성은 서버가 코드로 막습니다.

## 평가 계획서 불러오기 (.hwp, .hwpx, .docx)

학교 평가 계획서(한글 .hwp·.hwpx, 워드 .docx)를 올리면 과목별 평가 영역·주요 활동·평가 기준을 찾아 영역 카드에 자동으로 넣습니다.

- 화면 위 «평가 계획서 불러오기 (한글·워드)»를 누르거나 파일을 화면에 끌어다 놓습니다.
- 찾은 과목 목록에서 넣을 과목을 고릅니다(지금 고른 과목이 있으면 그 과목만 체크됨).
- 파일에 적힌 학년(예: 3학년)으로 들어가고, 화면도 그 학년으로 바뀝니다. 학년이 없는 파일은 지금 고른 학년으로 들어갑니다.
- 넣는 내용
  - **영역 이름:** «평가 영역» 칸 (같은 이름이 여러 개면 번호를 붙임)
  - **주요 활동:** 비워 둡니다. 선생님이 수업에서 한 활동을 직접 적도록 «주요 활동을 직접 넣어 주세요» 안내가 반짝입니다(적으면 사라짐).
  - **평가 기준:** «성취기준» + 성취 수준(매우 잘함·잘함·보통·노력 요함) 설명. 창의적 체험활동처럼 성취기준이 없는 표는 «평가 관점»
- 이미 입력한 영역이 있으면 뒤에 덧붙이고(같은 영역은 건너뜀), «이미 입력한 영역은 지우고 새로 넣기»를 켜면 바꿉니다.
- 파일은 브라우저 안에서만 읽고 어디로도 보내지 않습니다.
- 암호가 걸린 문서와 배포용 문서는 읽지 못합니다. 한글에서 암호를 풀거나 일반 문서로 저장해 올려 주세요.
- 표 머리글 한 줄에 **«평가 영역»(또는 «영역»)** 칸과 **평가 기준 계열 칸**(«성취기준», «평가 기준», «성취 수준», «평가 관점» 중 하나)이 함께 있어야 합니다. 없으면 «적절한 평가 기준 파일이 아닙니다.»라고 안내합니다.
- 알아보는 표 모양
  - 성취 수준이 줄로 나뉜 표: «성취 수준» 아래 [매우 잘함 | 설명], [잘함 | 설명] …
  - 성취 수준이 칸으로 나뉜 표: «평가 기준» 아래 상 | 중 | 하 (두 줄 머리글), 또는 머리글이 바로 상·중·하
  - «평가 기준»이 한 칸에 글로 적힌 표
- 과목은 «○○과 교수학습 및 평가 운영계획» 같은 표 제목에서 찾고, 못 찾으면 지금 고른 과목으로 넣습니다.
- 오래된 브라우저(압축 풀기 기능이 없는 경우)에서는 필요할 때만 cdnjs에서 pako를 받아 씁니다.

## 의견 만들기

두 가지 방법이 있습니다.

1. **의견 생성 (자동):** 영역 카드의 «의견 생성»을 누르면 서버가 Claude에게 의견 32개를 받아 바로 채웁니다. 30초~1분 걸립니다.
2. **직접 AI에 묻기:** «직접 AI에 묻기» → «프롬프트 복사» → Claude 등 AI에 붙여 넣기 → 받은 답을 붙여 넣고 «의견 넣기». 서버가 꺼져 있거나 오늘 횟수를 다 쓴 경우에도 이 방법은 늘 쓸 수 있습니다.

## 개인정보

- 입력한 내용(영역, 의견, 학생 표)은 **이 브라우저(localStorage)에만** 저장됩니다.
- «의견 생성»을 누를 때만 **과목·학년·영역 이름·주요 활동·평가 기준**이 의견 생성 서버(Firebase Functions)를 거쳐 Anthropic의 Claude API로 전송됩니다. 학생 표의 내용(학생별 척도·의견)은 보내지 않습니다.
- 서버는 하루 사용 횟수를 세려고 요청한 IP 주소를 해시(SHA-256)한 값만 Firestore에 남기며, 입력 내용은 저장하지 않습니다.
- 평가 기준에 학생 이름 같은 개인정보를 적지 마세요.

## 의견 생성 서버 (`functions/`)

Firebase Functions 2세대 함수 `generateOpinions` 하나입니다.

| 항목 | 값 |
|---|---|
| Firebase 프로젝트 | `teachingdiary-d14d5` (`.firebaserc`) |
| 지역 | `asia-northeast3` (서울) |
| 주소 | `https://asia-northeast3-teachingdiary-d14d5.cloudfunctions.net/generateOpinions` (`index.html`의 `API_URL`) |
| 모델 | `claude-opus-5-5`, 구조화 출력(JSON 스키마)으로 형식 고정, 거절 시 서버 측 대체 모델 사용 |
| 허용 주소(CORS) | `https://echoeun-glitch.github.io`, `localhost:5000/8080` (`functions/lib.js`의 `ALLOWED_ORIGINS`) |
| 사용 한도 | 사용자(IP)당 하루 30회, 전체 하루 300회 (한국 시간 기준, 바꿀 수 있음) |

요청과 응답:

```
POST /generateOpinions
{"subject":"체육","grade":"5학년","name":"표현","activity":"리듬 줄넘기","criteria":"…"}

200 {"text":"{\"최상\":[…8개],\"상\":[…],\"중\":[…],\"하\":[…]}","remaining":29}
4xx/5xx {"message":"사용자에게 보여 줄 안내"}   (429 = 오늘 한도 초과)
```

### 처음 배포하기

준비물: Node.js 22, Firebase CLI, Blaze(종량제) 요금제의 Firebase 프로젝트, [Claude API 키](https://platform.claude.com/settings/keys).

```bash
npm install -g firebase-tools
firebase login
```

```bash
cd functions && npm install && cd ..
```

Claude API 키를 Secret Manager에 저장합니다(입력 창에 키를 붙여 넣음). 키는 코드나 저장소에 넣지 않습니다.

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

입장 코드도 같은 방법으로 저장합니다(입력 창에 정할 코드를 입력).

```bash
firebase functions:secrets:set ACCESS_CODE
```

배포합니다. 처음에는 하루 한도(`DAILY_LIMIT_PER_USER`, `DAILY_LIMIT_TOTAL`)를 물어보며, 엔터를 누르면 기본값(30, 300)이 들어갑니다.

```bash
firebase deploy --only functions:evaluation-helper
```

배포가 끝나면 출력된 함수 주소가 `index.html`의 `API_URL`과 같은지 확인합니다.

같은 프로젝트의 다른 함수는 `codebase`가 달라 이 배포로 지워지거나 바뀌지 않습니다.

### 그 밖의 설정

- **한도 바꾸기:** `functions/.env`에 `DAILY_LIMIT_PER_USER=50`처럼 적고 다시 배포합니다.
- **사용 기록 자동 삭제:** Firestore 콘솔 → TTL 정책에서 컬렉션 `evaluationHelperUsage`, 필드 `expireAt`으로 정책을 만들면 3일 지난 기록이 지워집니다.
- **비용 상한:** Claude Console에서 월 사용 한도를, Google Cloud에서 예산 알림을 설정해 두세요.
- **입장 코드 바꾸기:** `firebase functions:secrets:set ACCESS_CODE`로 새 코드를 넣고, 다시 배포할지 물으면 `Y`.
- **로그 보기:** `firebase functions:log --only generateOpinions`

### 테스트

```bash
cd functions && npm test
```
