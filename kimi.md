调用案例：
const OpenAI = require("openai");
 
const client = new OpenAI({
    apiKey: "$MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.cn/v1",
});
 
history = [{"role": "system", "content": "你是 Kimi，由 Moonshot AI 提供的人工智能助手，你更擅长中文和英文的对话。你会为用户提供安全，有帮助，准确的回答。同时，你会拒绝一切涉及恐怖主义，种族歧视，黄色暴力等问题的回答。Moonshot AI 为专有名词，不可翻译成其他语言。"}]
 
async function chat(prompt) {
    history.append({
        role: "user", content: prompt
    })
    const completion = await client.chat.completions.create({
        model: "moonshot-v1-8k",         
        messages: history,
    });
    history = history.concat(completion.choices[0].message)
    return completion.choices[0].message.content;
}
 
async function main() {
    reply = await chat("地球的自转周期是多少？")
    console.log(reply);   
    reply = await chat("月球呢？")
    console.log(reply);
}
 
main();

AI key: sk-gyU2frMJfrQsg83w97A335n2cpoJPqCSePPgDhoywKaDWiJd