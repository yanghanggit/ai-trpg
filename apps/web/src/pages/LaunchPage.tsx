import ServerConnectionCard from "../features/connection/ServerConnectionCard";

export default function LaunchPage() {
  return (
    <main className="launch">
      <div className="launch__inner">
        <header className="launch__header">
          <p className="launch__eyebrow">AI TRPG</p>
          <h1>跑团服务连通性检查</h1>
          <p className="launch__lead">当前为空页阶段：只验证客户端能否读取服务端的健康检查接口。</p>
        </header>

        <ServerConnectionCard />

        <footer className="launch__footer">下一步：登录、大厅、角色与剧情。</footer>
      </div>
    </main>
  );
}
