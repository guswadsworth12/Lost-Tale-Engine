# Quick Start

You need the app running and a text model to generate new replies. Voice and image generation are optional. See [Installation and Docker](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Installation-and-Docker) if you have not started the server yet.

## First sign-in

1. Open the app on the computer running it. On a new data directory you are asked to **Create the owner account**: choose a username and password. If setup says it must be completed locally, open `localhost` on that computer, or run `npm run create-user` there.

   ![The Create the owner account screen on a fresh install](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-owner-setup.jpg)

2. The setup wizard opens: **Text model**, **Voice**, **Images**, **Invite players** (owners only), **First story**. In **Text model**, add the service you use (a hosted service with its key, or a model server under **On your machine**), pick a model, and press **Test it**. **Continue** unlocks once the model answers.

   ![The wizard's Text model step with a local Ollama server connected and its test reply shown](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-setup-text-model.jpg)

3. **Voice** offers free voices (**Use free voices**) or another voice service; **Images** can be skipped with **Skip for now**.
4. **Invite players** (owners only, optional) adds accounts for the people you play with, the same form as **Admin → Add user**.
5. In **First story**, choose **Play the starter world** (below), pick any character to start with, or **Finish here and open Cast** to build your own. **Set up later** at the top puts the wizard away; everything left stays on the checklist in **Settings → Get set up**, and each step ticks itself once it's done.

When setup finishes, the guided tour starts. Replay it any time from **Help & tutorial**.

Every person signs into their own account. The owner can add accounts later; see [Accounts and Sharing](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Accounts-and-Sharing).

## Start with Hollowmere

The quickest way in is setup's **Play the starter world**:

1. Under **Who you play**, keep **Rowan Hale**, or choose **Someone of your own** and give a name and a few words about them.
2. Select **Start the story**. The story opens in Visual Novel mode on the night platform. The Game Master narrates the opening and runs every turn, and the hooded passenger is played by the Game Master until the mystery's turning point.
3. Say what you do in the message box. Use **Story panel** to see the chapter goal and the scene.

To start it by hand instead, for example on an account that has already finished setup (this opens with Mara's greeting; the Game Master turns, the passenger's set event and the chapter goal are yours to add in **Story panel**):

1. Open **Stories → Start a story**. Under **World**, choose **Hollowmere Station** and press **Continue**.
2. Under **Cast**, choose **Mara Vale** as the **Main character** and add **Tavi Rook** and **Hooded Passenger** as other characters.

   ![Start a story, Cast step: Mara Vale as main character with Hooded Passenger and Tavi Rook added](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-start-story-cast.jpg)

3. Under **Who you play**, choose **Rowan Hale**.
4. Under **Opening scene**, keep the **Visual Novel** story style and the opening line, then select **Begin story**.

   ![Start a story, Opening scene step with the Visual Novel style and Mara's opening line](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-start-story-opening.jpg)

5. Read Mara's introduction, click **Say something as Rowan Hale…**, and type Rowan's response. Use **Story panel** to inspect the scene and **Back to Stories** to return to the library. Your story stays there.

The app bundles Hollowmere's world, cast, and art. A text model supplies later replies. The [Hollowmere guide](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Hollowmere-Station) shows the cast and three-scene outline without revealing the mystery's answer.

If the story opens but a reply will not generate, check **Settings → Models and services** and the [troubleshooting steps](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Troubleshooting). A "thinking" model that fails with *spent its whole reply budget on hidden reasoning* needs **Settings → Generation → Reasoning token reserve**.
