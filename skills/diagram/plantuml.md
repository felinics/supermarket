# PlantUML Reference

PlantUML 是一套用纯文本描述 UML 及多种软件图形的工具，支持序列图、类图、用例图、组件图、部署图、活动图、状态图等。本文是 diagram skill 的 PlantUML 深度参考文档。

---

## 1. Rendering（渲染）

### 本地 JAR 渲染

需要 Java 8+ 和 Graphviz（部分图类型）。

```F:\supermarket\skills\diagram\plantuml.md#L1-1
# 输出 PNG（默认）
java -jar plantuml.jar input.puml

# 输出 SVG
java -jar plantuml.jar -tsvg input.puml

# 输出 EPS
java -jar plantuml.jar -teps input.puml

# 指定输出目录
java -jar plantuml.jar -o ./output input.puml

# 批量渲染目录下所有 .puml
java -jar plantuml.jar -tsvg ./diagrams/
```

### Online API 渲染

PlantUML 官方提供免费的在线渲染服务，URL 格式为：

```F:\supermarket\skills\diagram\plantuml.md#L1-1
https://www.plantuml.com/plantuml/png/{encoded}
https://www.plantuml.com/plantuml/svg/{encoded}
https://www.plantuml.com/plantuml/uml/{encoded}
```

编码步骤：原始文本 → UTF-8 → Deflate 压缩 → Base64 变体编码（PlantUML 使用自定义字符集 `0-9ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_`）。

可用 `plantuml-encoder` npm 包或 Python `zlib` + 自定义 Base64 实现编码。

### VS Code PlantUML 扩展（无需本地 Java）

安装扩展：`jebbs.plantuml`

在 `settings.json` 中配置远程渲染：

```F:\supermarket\skills\diagram\plantuml.md#L1-1
{
  "plantuml.render": "PlantUMLServer",
  "plantuml.server": "https://www.plantuml.com/plantuml",
  "plantuml.exportFormat": "svg"
}
```

快捷键：`Alt+D` 预览，`Ctrl+Shift+P` → `PlantUML: Export Current Diagram` 导出。

### 使用 `scripts/render.py` 渲染

```F:\supermarket\skills\diagram\plantuml.md#L1-1
# 基本用法
python scripts/render.py input.puml output.png

# 输出 SVG
python scripts/render.py input.puml output.svg

# 指定 PlantUML JAR 路径
python scripts/render.py input.puml output.png --jar /path/to/plantuml.jar
```

---

## 2. Sequence Diagram（序列图）

### 参与者类型

| 关键字         | 说明                   | 图形外观       |
|----------------|------------------------|----------------|
| `participant`  | 默认参与者（矩形）     | 矩形           |
| `actor`        | 人形参与者             | 小人           |
| `boundary`     | 边界（UI/接口层）      | 竖线+圆        |
| `control`      | 控制（逻辑层）         | 圆+箭头        |
| `entity`       | 实体（数据层）         | 圆+横线        |
| `database`     | 数据库                 | 圆柱           |
| `collections`  | 集合                   | 多层矩形       |
| `queue`        | 队列                   | 双竖线矩形     |

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
actor       User        as U
boundary    WebUI       as W
control     AppService  as S
entity      OrderEntity as E
database    DB          as D
collections EventBus    as B
queue       MQ          as Q
@enduml
```

### 箭头类型

| 语法             | 说明                             |
|------------------|----------------------------------|
| `->`             | 实线箭头                         |
| `-->`            | 虚线箭头（返回）                 |
| `->>`            | 实线细箭头（异步）               |
| `-->>`           | 虚线细箭头（异步返回）           |
| `-x`             | 带 X 的箭头（丢失的消息）        |
| `->o`            | 实线圆头箭头                     |
| `-[#red]>`       | 自定义颜色箭头                   |
| `<->`            | 双向实线箭头                     |

### activate / deactivate / autoactivate

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
participant A
participant B

A -> B : request
activate B
B -> B : internal process
B --> A : response
deactivate B

' 自动激活（整个图生效）
autoactivate on
A -> B : call
B --> A : reply
@enduml
```

### 控制块

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
participant Client
participant Server

' alt/else - 条件分支
alt 认证成功
    Client -> Server : 获取数据
    Server --> Client : 200 OK
else 认证失败
    Server --> Client : 401 Unauthorized
end

' opt - 可选块
opt 启用缓存
    Server -> Server : 写入缓存
end

' loop - 循环
loop 每隔 5 秒
    Client -> Server : 心跳
    Server --> Client : pong
end

' par - 并行
par 并行处理
    Server -> Server : 写日志
also
    Server -> Server : 发通知
end

' break - 提前终止
break 发生异常
    Server --> Client : 500 Error
end

' group - 自定义分组
group 自定义标签
    Client -> Server : 批量操作
end

' ref - 引用另一个序列图
ref over Client, Server
    参见：登录流程
end
@enduml
```

### 注释（note）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
participant A
participant B
participant C

A -> B : 消息1
note left : 左侧注释
note right : 右侧注释

B -> C : 消息2
note over B, C : 跨越多个参与者的注释

note over A
    多行注释
    第二行内容
end note
@enduml
```

### 分隔符与自动编号

```F:\startuml
@startuml
autonumber
participant A
participant B

A -> B : 第一条消息

== 初始化阶段结束 ==

autonumber 10 5
A -> B : 编号从 10 开始，步长 5

== 业务处理阶段 ==

autonumber stop
A -> B : 不再编号的消息

autonumber resume
A -> B : 继续从上次编号
@enduml
```

### 完整序列图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 用户登录流程

actor       用户        as U
boundary    前端        as FE
control     认证服务    as Auth
database    用户数据库  as DB

autonumber

U -> FE : 输入用户名/密码
activate FE

FE -> Auth : POST /login {username, password}
activate Auth

Auth -> DB : SELECT * FROM users WHERE username=?
activate DB
DB --> Auth : 用户记录
deactivate DB

alt 密码匹配
    Auth -> Auth : 生成 JWT Token
    Auth --> FE : 200 OK {token}
    deactivate Auth
    FE --> U : 登录成功，跳转首页
else 密码不匹配
    Auth --> FE : 401 Unauthorized
    deactivate Auth
    FE --> U : 显示错误提示
end

deactivate FE

note over Auth
    Token 有效期：24h
    使用 RS256 签名
end note
@enduml
```

---

## 3. Class Diagram（类图）

### 类定义

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
' 普通类
class Animal {
    - name : String
    # age : int
    + eat() : void
    + {abstract} speak() : String
}

' 抽象类
abstract class Vehicle {
    - speed : int
    + {abstract} move() : void
    + {static} getMaxSpeed() : int
}

' 接口
interface Flyable {
    + fly() : void
    + land() : void
}

' 枚举
enum Status {
    PENDING
    ACTIVE
    CLOSED
}

' 注解类
annotation NonNull
@enduml
```

### 成员可见性

| 符号 | 说明      |
|------|-----------|
| `+`  | public    |
| `-`  | private   |
| `#`  | protected |
| `~`  | package   |

### 静态与抽象修饰符

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
class MyClass {
    + {static} staticField : int
    + {abstract} abstractMethod() : void
    + {static} staticMethod() : String
}
@enduml
```

### 所有关系类型

| 关系     | 箭头语法    | 说明                         |
|----------|-------------|------------------------------|
| 继承     | `<|--`      | 实线空心三角（子 → 父）      |
| 实现     | `<|..`      | 虚线空心三角（类 → 接口）    |
| 组合     | `*--`       | 实线实心菱形（整体 → 部分）  |
| 聚合     | `o--`       | 实线空心菱形（容器 → 元素）  |
| 关联     | `-->`       | 实线箭头                     |
| 依赖     | `..>`       | 虚线箭头                     |
| 双向关联 | `--`        | 实线无箭头                   |
| 注释关联 | `.. `       | 虚线                         |

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
Animal <|-- Dog           : 继承
Flyable <|.. Bird         : 实现
House *-- Room            : 组合（1 对多）
Team o-- Player           : 聚合
Order --> Customer        : 关联
Service ..> Repository    : 依赖
@enduml
```

### 注解（Stereotypes）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
class UserService <<Service>> {
    + findById(id: Long) : User
}

class UserRepository <<Repository>> {
    + save(user: User) : void
}

interface UserDAO <<Interface>>

class User <<Entity>> {
    - id : Long
    - name : String
}
@enduml
```

### 命名空间（namespace）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
namespace com.example.domain {
    class User
    class Order
}

namespace com.example.service {
    class UserService
}

com.example.service.UserService ..> com.example.domain.User
@enduml
```

### 泛型

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
class Repository<T> {
    + findAll() : List<T>
    + findById(id: Long) : Optional<T>
    + save(entity: T) : T
}

class UserRepository extends Repository<User>
@enduml
```

### 完整类图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 电商订单系统类图

namespace com.shop.domain {

    abstract class BaseEntity {
        - id : Long
        - createdAt : LocalDateTime
        - updatedAt : LocalDateTime
    }

    class User <<Entity>> {
        - username : String
        - email : String
        - passwordHash : String
        + getOrders() : List<Order>
    }

    class Order <<Entity>> {
        - orderNo : String
        - status : OrderStatus
        - totalAmount : BigDecimal
        + addItem(item: OrderItem) : void
        + calculateTotal() : BigDecimal
    }

    class OrderItem <<Entity>> {
        - quantity : int
        - unitPrice : BigDecimal
        + getSubtotal() : BigDecimal
    }

    class Product <<Entity>> {
        - name : String
        - price : BigDecimal
        - stock : int
    }

    enum OrderStatus {
        PENDING
        PAID
        SHIPPED
        DELIVERED
        CANCELLED
    }

    interface Priceable {
        + getPrice() : BigDecimal
    }

    BaseEntity <|-- User
    BaseEntity <|-- Order
    BaseEntity <|-- OrderItem
    BaseEntity <|-- Product

    Priceable <|.. Product
    Priceable <|.. OrderItem

    User "1" --> "0..*" Order : 下单
    Order "1" *-- "1..*" OrderItem : 包含
    OrderItem "0..*" --> "1" Product : 对应
    Order --> OrderStatus : 使用
}
@enduml
```

---

## 4. Use Case Diagram（用例图）

> Mermaid 不原生支持用例图，这是 PlantUML 特有的优势场景。

### 基本元素

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
' Actor 定义
actor 用户 as U
actor 管理员 as A
actor "外部支付系统" as Pay

' UseCase 定义
usecase "登录" as UC1
usecase "浏览商品" as UC2
usecase "下单" as UC3
usecase "支付" as UC4
usecase "管理商品" as UC5
usecase "查看报表" as UC6

' 系统边界
rectangle 电商系统 {
    UC1
    UC2
    UC3
    UC4
    UC5
    UC6
}

' 关联（Actor 与 UseCase）
U -- UC1
U -- UC2
U -- UC3
U -- UC4
A -- UC5
A -- UC6

' include（必须包含）
UC3 .> UC1 : <<include>>

' extend（可选扩展）
UC4 .> UC3 : <<extend>>

' 泛化（继承）
Pay <|-- UC4
@enduml
```

### 完整用例图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 图书馆管理系统

left to right direction

actor 读者 as Reader
actor 图书管理员 as Librarian
actor "短信服务" as SMS

rectangle 图书馆系统 {
    usecase "搜索图书" as Search
    usecase "预约图书" as Reserve
    usecase "借阅图书" as Borrow
    usecase "归还图书" as Return
    usecase "支付罚款" as Pay
    usecase "发送通知" as Notify
    usecase "管理图书" as Manage
    usecase "生成报表" as Report
    usecase "用户认证" as Auth
}

Reader -- Search
Reader -- Reserve
Reader -- Borrow
Reader -- Return
Reader -- Pay

Librarian -- Manage
Librarian -- Report

Borrow .> Auth : <<include>>
Reserve .> Auth : <<include>>
Return .> Notify : <<include>>
Pay .> Notify : <<extend>>

SMS -- Notify
@enduml
```

---

## 5. Component Diagram（组件图）

> Mermaid 不原生支持组件图，PlantUML 在此场景更专业。

### 基本元素

| 关键字      | 说明           |
|-------------|----------------|
| `component` | 组件           |
| `interface` | 接口（提供/需求）|
| `package`   | 包/模块分组    |
| `cloud`     | 云/外部系统    |
| `node`      | 物理节点       |
| `database`  | 数据库         |
| `[ComponentName]` | 方括号简写组件 |

### 连接方式

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
component A
component B
interface IService

A --> B          : 使用
A - IService     : 提供接口
B ..> IService   : 依赖接口（需求）
@enduml
```

### 完整组件图示例（三层架构）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 三层架构组件图

skinparam componentStyle rectangle

package "表示层 (Presentation)" #DDEEFF {
    component [Web Browser] as Browser
    component [Mobile App] as Mobile
    component [API Gateway] as Gateway
}

package "业务逻辑层 (Business)" #DDFFD4 {
    component [用户服务\nUserService] as UserSvc
    component [订单服务\nOrderService] as OrderSvc
    component [商品服务\nProductService] as ProductSvc
    component [通知服务\nNotificationService] as NotifySvc

    interface IUserAPI
    interface IOrderAPI
    interface IProductAPI
}

package "数据访问层 (Data)" #FFEEDD {
    database "用户数据库\nMySQL" as UserDB
    database "订单数据库\nMySQL" as OrderDB
    database "商品数据库\nMySQL" as ProductDB
    database "缓存\nRedis" as Cache
    component [消息队列\nRabbitMQ] as MQ
}

cloud "外部服务" #EEEEFF {
    component [短信网关] as SMSGateway
    component [支付平台] as Payment
}

Browser --> Gateway : HTTPS
Mobile --> Gateway  : HTTPS

Gateway --> IUserAPI
Gateway --> IOrderAPI
Gateway --> IProductAPI

IUserAPI    - UserSvc
IOrderAPI   - OrderSvc
IProductAPI - ProductSvc

UserSvc    --> UserDB
OrderSvc   --> OrderDB
ProductSvc --> ProductDB

UserSvc    --> Cache
ProductSvc --> Cache

OrderSvc --> MQ
MQ --> NotifySvc

NotifySvc --> SMSGateway
OrderSvc --> Payment
@enduml
```

---

## 6. Deployment Diagram（部署图）

### 基本元素

| 关键字     | 说明         |
|------------|--------------|
| `node`     | 物理/逻辑节点 |
| `artifact` | 部署制品（JAR、WAR、Docker Image）|
| `cloud`    | 云环境       |
| `database` | 数据库       |
| `component`| 组件         |
| `package`  | 包/分组      |

### 完整部署图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 生产环境部署架构

cloud "阿里云 VPC" {

    node "负载均衡\nSLB" as LB {
        artifact "Nginx\n负载均衡规则" as NginxConf
    }

    package "Kubernetes 集群" {
        node "Web Pod x3" as WebPod {
            artifact "frontend:v1.2.0\n(Docker Image)" as FrontendImg
        }
        node "API Pod x3" as APIPod {
            artifact "backend:v2.1.0\n(Docker Image)" as BackendImg
        }
        node "Worker Pod x2" as WorkerPod {
            artifact "worker:v2.1.0\n(Docker Image)" as WorkerImg
        }
    }

    package "数据层" {
        database "RDS MySQL\n主从复制" as MySQL {
            artifact "orders_db" as OrdersDB
            artifact "users_db" as UsersDB
        }
        database "Redis Cluster\n缓存层" as Redis
        node "RabbitMQ\n消息队列" as RMQ
        database "OSS\n对象存储" as OSS
    }

    node "日志与监控" {
        artifact "Elasticsearch" as ES
        artifact "Kibana" as Kibana
        artifact "Prometheus" as Prom
    }
}

cloud "CDN" as CDN

CDN --> LB : 回源
LB --> WebPod : HTTP
LB --> APIPod : HTTP

WebPod --> APIPod : REST API
APIPod --> MySQL
APIPod --> Redis
APIPod --> RMQ
APIPod --> OSS

RMQ --> WorkerPod

WebPod --> ES : 日志
APIPod --> ES : 日志
APIPod --> Prom : 指标
@enduml
```

---

## 7. Activity Diagram（活动图，新语法 Beta）

> 新语法（Beta）比旧语法更简洁易读，推荐使用。

### 基本元素

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
start

:步骤一;
:步骤二;

if (条件判断?) then (是)
    :执行 A;
else (否)
    :执行 B;
endif

:继续执行;

stop
@enduml
```

### 条件与循环

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
start

' while 循环
while (还有数据?) is (是)
    :读取一条记录;
    :处理记录;
endwhile (否)

' repeat...repeat while 循环
repeat
    :尝试连接;
repeat while (连接成功?) is (否) not (是)

' 嵌套条件
if (用户已登录?) then (是)
    if (有权限?) then (是)
        :执行操作;
    else (否)
        :返回 403;
        stop
    endif
else (否)
    :跳转登录页;
    stop
endif

stop
@enduml
```

### fork / join（并行）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
start

:接收订单;

fork
    :库存扣减;
fork again
    :发送确认邮件;
fork again
    :写入审计日志;
end fork

:订单处理完成;
stop
@enduml
```

### 泳道（Swimlane）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
|用户|
start
:提交订单;

|#AntiqueWhite|订单服务|
:验证订单;
:创建订单记录;

|库存服务|
:检查库存;
if (库存充足?) then (是)
    :锁定库存;
else (否)
    |订单服务|
    :标记缺货;
    |用户|
    :通知用户补货;
    stop
endif

|支付服务|
:发起支付;
if (支付成功?) then (是)
    |库存服务|
    :扣减库存;
    |订单服务|
    :更新订单状态为已支付;
else (否)
    |库存服务|
    :释放锁定库存;
    |订单服务|
    :取消订单;
endif

|用户|
:显示结果;
stop
@enduml
```

### 完整活动图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title CI/CD 流水线活动图

|#LightBlue|开发者|
start
:推送代码到 Git;

|#LightGreen|CI 系统|
:触发流水线;

fork
    :代码静态分析\n(ESLint / SonarQube);
fork again
    :单元测试\n(Jest / JUnit);
end fork

if (检查全部通过?) then (是)
    :构建 Docker 镜像;
    :推送到镜像仓库;
else (否)
    |#LightBlue|开发者|
    :收到失败通知;
    :修复问题;
    stop
endif

|#LightYellow|CD 系统|
:部署到 Staging 环境;
:运行集成测试;
:运行 E2E 测试;

if (所有测试通过?) then (是)
    :等待人工审批;

    |#LightBlue|开发者|
    :审批发布;

    |#LightYellow|CD 系统|
    :蓝绿部署到生产环境;
    :健康检查;
    if (健康检查通过?) then (是)
        :切换流量到新版本;
        :清理旧版本;
    else (否)
        :回滚到上一版本;
        :发送告警通知;
    endif
else (否)
    |#LightBlue|开发者|
    :收到测试失败报告;
    stop
endif

stop
@enduml
```

---

## 8. State Diagram（状态图）

### 基本状态转换

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
[*] --> 待支付 : 创建订单
待支付 --> 已支付 : 支付成功
待支付 --> 已取消 : 超时/用户取消
已支付 --> 已发货 : 发货
已发货 --> 已签收 : 物流签收
已签收 --> [*]
已取消 --> [*]
@enduml
```

### 内部转换与状态描述

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
state "正在处理" as Processing {
    Processing : entry / 开始计时
    Processing : exit / 停止计时
    Processing : do / 执行任务
    Processing --> Processing : 重试 [次数 < 3]
}
@enduml
```

### 嵌套状态

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
[*] --> 未登录

state 已登录 {
    [*] --> 浏览中
    浏览中 --> 购物车 : 加入购物车
    购物车 --> 结算中 : 提交订单
    结算中 --> 浏览中 : 支付完成
}

未登录 --> 已登录 : 登录成功
已登录 --> 未登录 : 退出登录
@enduml
```

### 并发区域

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
[*] --> 活跃

state 活跃 {
    state "音频控制" as Audio {
        [*] --> 播放中
        播放中 --> 暂停 : pause
        暂停 --> 播放中 : play
    }

    --

    state "视频控制" as Video {
        [*] --> 全屏
        全屏 --> 窗口 : 退出全屏
        窗口 --> 全屏 : 进入全屏
    }
}

活跃 --> [*] : 关闭
@enduml
```

### 完整状态图示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 订单状态机

[*] --> 草稿 : 用户开始下单

state 草稿 {
    草稿 : entry / 生成临时订单号
}

草稿 --> 待支付 : 提交订单
草稿 --> [*] : 放弃

state 待支付 {
    待支付 : entry / 启动支付超时计时器 (30min)
    待支付 : exit / 停止计时器
    [*] --> 等待支付回调
    等待支付回调 --> 支付确认中 : 收到支付回调
}

待支付 --> 已取消 : 超时 / 主动取消
待支付 --> 已支付 : 支付成功

state 已支付 {
    [*] --> 待拣货
    待拣货 --> 拣货中 : 仓库接单
    拣货中 --> 待出库 : 拣货完成
}

已支付 --> 已发货 : 出库扫描
已发货 --> 已签收 : 签收确认
已签收 --> 售后中 : 发起退货 [7天内]
售后中 --> 已退款 : 退款审核通过
售后中 --> 已签收 : 退货被拒
已签收 --> [*] : 评价完成

已取消 --> [*]
已退款 --> [*]
@enduml
```

---

## 9. Theming & Styling（主题与样式）

### skinparam 语法

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
' 全局设置
skinparam backgroundColor #FAFAFA
skinparam defaultFontName "Microsoft YaHei"
skinparam defaultFontSize 13

' 针对特定元素类型设置
skinparam participant {
    BackgroundColor #D4E6F1
    BorderColor #2E86C1
    FontColor #1A252F
}

skinparam sequence {
    ArrowColor #2E86C1
    LifeLineBorderColor #2E86C1
    LifeLineBackgroundColor #EBF5FB
}
@enduml
```

### 常用 skinparam 属性

| 属性                           | 说明                    |
|--------------------------------|-------------------------|
| `BackgroundColor`              | 图形背景色              |
| `ArrowColor`                   | 箭头颜色                |
| `BorderColor`                  | 边框颜色                |
| `FontColor`                    | 字体颜色                |
| `FontName`                     | 字体名称                |
| `FontSize`                     | 字体大小                |
| `RoundCorner`                  | 圆角半径（类/组件图）   |
| `Shadowing`                    | 是否有阴影（true/false）|
| `ClassBackgroundColor`         | 类图背景色              |
| `ClassBorderColor`             | 类图边框色              |
| `NoteBackgroundColor`          | 注释背景色              |
| `SequenceLifeLineBorderColor`  | 序列图生命线颜色        |
| `ComponentStyle`               | 组件图样式（rectangle） |

### 内置主题（`!theme` 指令）

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain          ' 简洁白色（推荐文档）
' !theme cerulean    ' 蓝色系
' !theme materia     ' Material Design 风格
' !theme minty       ' 淡绿色清新风格
' !theme sandstone   ' 沙石色温暖风格
' !theme sketchy     ' 手绘风格
' !theme spacelab    ' 深蓝太空风格
' !theme superhero   ' 深色主题
' !theme united      ' 橙色活力风格
' !theme amiga       ' 复古风格
@enduml
```

查看所有主题列表：`java -jar plantuml.jar -themes`

### PlantUML 颜色常量

可直接使用 HTML 颜色名和以下 PlantUML 内建颜色：

`#Red` `#Blue` `#Green` `#Yellow` `#Orange` `#Purple` `#Pink`  
`#Cyan` `#White` `#Black` `#Gray` `#LightBlue` `#LightGreen`  
`#Gold` `#Tomato` `#DarkGreen` `#Navy` `#Coral` `#Salmon`

也可使用十六进制：`#FF5733`、`#2E86C1`

### 完整 skinparam 示例

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
!theme plain
title 自定义样式示例

skinparam {
    backgroundColor #F8F9FA
    defaultFontName "Segoe UI"
    defaultFontSize 12
    shadowing false
    roundCorner 8
}

skinparam class {
    BackgroundColor     #DDEEFF
    BorderColor         #336699
    FontColor           #1A1A2E
    HeaderBackgroundColor #336699
    HeaderFontColor     #FFFFFF
    StereotypeFontColor #555555
    ArrowColor          #336699
    AttributeFontColor  #333333
}

skinparam note {
    BackgroundColor     #FFFDE7
    BorderColor         #F9A825
    FontColor           #5D4037
}

class UserService <<Service>> {
    - userRepo : UserRepository
    + findById(id: Long) : User
    + save(user: User) : User
}

class UserRepository <<Repository>> {
    - db : DataSource
    + findById(id: Long) : User
}

note right of UserService
    通过构造器注入依赖
    使用 @Transactional 注解
end note

UserService --> UserRepository : 依赖
@enduml
```

---

## 10. Common Pitfalls（常见陷阱）

### 中文与特殊字符需加引号

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
' 错误：含空格的名称会解析失败
' participant 用 户 服 务

' 正确：使用引号包裹
participant "用户服务" as UserService
actor "系统管理员" as Admin

' 或使用 as 别名（推荐）
participant UserService as "用户服务"
@enduml
```

### 箭头标签中避免直接使用冒号

PlantUML 使用冒号 `:` 分隔参与者和消息文本，在消息内容中需要转义：

```F:\supermarket\skills\diagram\plantuml.md#L1-1
@startuml
participant A
participant B

' 错误：冒号会导致解析错误
' A -> B : GET /api/users: 获取用户列表

' 正确：用 \: 转义冒号
A -> B : GET /api/users\: 获取用户列表

' 或用 HTML 转义
A -> B : <U+003A> 方式（不推荐，可读性差）
@enduml
```

### PlantUML vs Mermaid 主要语法差异对比

| 功能           | PlantUML                          | Mermaid                         |
|----------------|-----------------------------------|---------------------------------|
| 序列图开头     | `@startuml` ... `@enduml`         | ` ```mermaid ` `sequenceDiagram`|
| 参与者声明     | `participant A`                   | `participant A`（语法相似）     |
| 虚线箭头       | `A --> B`                         | `A-->>B`                        |
| 注释           | `note over A, B : text`           | `Note over A,B: text`           |
| 类图继承       | `Child <\|-- Parent`              | `Parent <\|-- Child`（方向相反）|
| 类图实现       | `Class <\|.. Interface`           | `Class ..\|> Interface`         |
| 活动图         | 新 Beta 语法（`if/then/else`）    | `flowchart TD`（流程图代替）    |
| 用例图         | 原生支持                          | **不支持**                      |
| 组件图         | 原生支持                          | **不支持**                      |
| 主题           | `!theme xxx`                      | `%%{init: {'theme': 'xxx'}}%%`  |
| 颜色           | `skinparam` 或 `[#color]`         | `style nodeId fill:#color`      |
| 泳道           | `\|泳道名\|`（活动图）            | `subgraph` 近似模拟             |
| 状态图并发     | `--`（双横线分隔并发区域）        | 不支持                          |
| 内联 HTML      | 部分支持（`<b>`, `<i>` 等）       | 不支持                          |

### 何时选 PlantUML 而非 Mermaid

选择 **PlantUML** 当：

1. **需要用例图或组件图** —— Mermaid 不支持，PlantUML 是首选
2. **需要精细的 UML 语义** —— PlantUML 严格遵循 UML 2.x 规范（聚合 vs 组合、依赖 vs 关联）
3. **需要复杂序列图** —— `par`、`break`、`ref`、`autoactivate`、精细生命线控制
4. **需要 skinparam 深度定制样式** —— PlantUML 样式系统更完善
5. **需要状态图并发区域** —— `--` 分隔并发正交区域
6. **企业/团队已有 PlantUML 工具链** —— 与 Confluence、Jira、IDE 插件深度集成
7. **需要从代码自动生成图形** —— PlantUML 有成熟的 Javadoc、Doxygen 集成

选择 **Mermaid** 当：

1. **嵌入 GitHub/GitLab Markdown** —— 原生渲染支持，无需额外工具
2. **简单流程图和甘特图** —— 语法更简洁
3. **前端项目内嵌渲染** —— `mermaid.js` 可在浏览器运行，无需服务端
4. **团队对 UML 要求不严格** —— 快速可视化即可
